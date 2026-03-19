from __future__ import annotations

import io
import logging
import os
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import Optional

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.figure import Figure
from PIL import Image
from obspy import UTCDateTime

from .models import Event, PlotResult, Station

logger = logging.getLogger(__name__)


def _to_utc(iso: str) -> UTCDateTime:
    return UTCDateTime(iso)


def _render_single(
    waveform_bytes: bytes,
    sensitivity: Optional[float],
    station: Station,
    events: list[Event],
    starttime_iso: str,
    endtime_iso: str,
    output_dir: str,
) -> PlotResult | None:
    """Runs in a worker process. Parses waveform, removes gain, creates plot."""
    import obspy
    import numpy as np

    starttime = _to_utc(starttime_iso)
    endtime = _to_utc(endtime_iso)

    try:
        st = obspy.read(io.BytesIO(waveform_bytes))
    except Exception as e:
        logger.error("Failed to parse waveform for %s: %s", station.id, e)
        return None

    if len(st) == 0:
        return None

    # Detrend + demean, then divide by sensitivity to get m/s
    try:
        st.detrend("demean")
        st.detrend("linear")
    except Exception as e:
        logger.warning("Could not detrend %s: %s", station.id, e)

    if sensitivity and sensitivity > 0:
        for tr in st:
            tr.data = tr.data.astype(np.float64) / sensitivity * 1e9  # convert to nm/s
        data_unit = "nm/s"
    else:
        data_unit = "Counts"
        logger.warning("No sensitivity for %s, plotting in raw counts", station.id)

    # Filter events that fall within the plot time window
    plot_events = []
    for ev in events:
        ev_time = _to_utc(ev.time_iso)
        if starttime <= ev_time <= endtime:
            plot_events.append((ev_time, ev))

    plot_id = station.id
    output_file = os.path.join(output_dir, f"{plot_id}.png")
    thumbnail_file = os.path.join(output_dir, f"{plot_id}_thumb.png")

    # Wider figure: extra right margin for event legend
    fig = Figure(figsize=(12, 7))
    try:
        # Plot waveform WITHOUT obspy event markers — keep data clean
        # No vertical_scaling_range → autoscale to actual data amplitudes
        st.plot(
            type="dayplot",
            interval=60,
            starttime=starttime,
            right_vertical_labels=False,
            one_tick_per_line=True,
            color=["k", "r", "b", "g"],
            show_y_UTC_label=False,
            events=[],
            number_of_ticks=5,
            tick_format="%H:%M UTC",
            vertical_plotting_method="mean",
            data_unit=data_unit,
            linewidth=0.5,
            x_labels_size=8,
            y_labels_size=8,
            fig=fig,
        )

        # Replace y-axis labels with actual row start times
        # interval=60 means each row is 60 minutes (3600 seconds)
        row_interval_sec = 60 * 60
        if fig.axes:
            ax = fig.axes[0]
            ax.set_ylabel("UTC", fontsize=8)
            yticks = ax.get_yticks()
            clean_labels = []
            for i in range(len(yticks)):
                row_start = starttime + i * row_interval_sec
                clean_labels.append(row_start.strftime("%H:%M UTC"))
            if len(clean_labels) == len(yticks):
                ax.set_yticklabels(clean_labels)

        # Make room for the event legend on the right
        fig.subplots_adjust(right=0.75)

        # Draw subtle vertical reference lines for events + build legend
        ax = fig.axes[0] if fig.axes else None
        if ax and plot_events:
            interval_seconds = 60 * 60  # 60 min intervals
            total_seconds = endtime - starttime
            n_rows = int(total_seconds / interval_seconds)

            for ev_time, ev in plot_events:
                # Calculate which row and x-position within that row
                elapsed = ev_time - starttime
                row = int(elapsed / interval_seconds)
                x_in_row = (elapsed - row * interval_seconds) / interval_seconds
                if 0 <= row < n_rows:
                    # Thin dashed line — visible but doesn't obscure data
                    ax.axvline(
                        x=x_in_row,
                        ymin=1 - (row + 1) / n_rows,
                        ymax=1 - row / n_rows,
                        color="red",
                        linestyle="--",
                        linewidth=0.4,
                        alpha=0.5,
                    )

            # Event legend in right margin — sorted by time, no overlap
            legend_y = 0.92
            fig.text(
                0.77, 0.96, "Events (UTC)",
                fontsize=7, fontweight="bold",
                transform=fig.transFigure,
            )
            for ev_time, ev in sorted(plot_events, key=lambda x: x[0]):
                if legend_y < 0.05:
                    fig.text(
                        0.77, legend_y, "...",
                        fontsize=6, transform=fig.transFigure,
                    )
                    break
                time_str = ev_time.strftime("%H:%M")
                label = f"{time_str}  M{ev.magnitude:.1f}  {ev.description[:25]}"
                fig.text(
                    0.77, legend_y, label,
                    fontsize=5.5, color="0.3",
                    transform=fig.transFigure,
                    verticalalignment="top",
                )
                legend_y -= 0.025

        title = (
            f"{st[0].stats.network}.{st[0].stats.station}."
            f"{st[0].stats.location}.{st[0].stats.channel}\n"
            f"UTC: {starttime.strftime('%Y-%m-%d %H:%M:%S')} to "
            f"{endtime.strftime('%Y-%m-%d %H:%M:%S')}"
        )
        fig.suptitle(title, fontsize=10, y=1.02)
        fig.savefig(output_file, dpi=300, bbox_inches="tight")

        img = Image.open(output_file)
        img.thumbnail((200, 200))
        img.save(thumbnail_file)

        return PlotResult(
            station=station,
            filename=os.path.basename(output_file),
            thumbnail=os.path.basename(thumbnail_file),
            starttime=starttime_iso,
            endtime=endtime_iso,
        )
    except Exception as e:
        logger.error("Error creating helicorder for %s: %s", station.id, e)
        return None
    finally:
        plt.close(fig)


def generate_plots(
    waveform_data: list[tuple[Station, bytes, Optional[float]]],
    events: list[Event],
    starttime: UTCDateTime,
    endtime: UTCDateTime,
    output_dir: str,
    max_workers: int = 8,
) -> list[PlotResult]:
    os.makedirs(output_dir, exist_ok=True)

    starttime_iso = starttime.isoformat()
    endtime_iso = endtime.isoformat()

    plots: list[PlotResult] = []

    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(
                _render_single,
                wf_data,
                sens,
                station,
                events,
                starttime_iso,
                endtime_iso,
                output_dir,
            ): station
            for station, wf_data, sens in waveform_data
        }

        for future in as_completed(futures):
            station = futures[future]
            try:
                result = future.result()
                if result:
                    plots.append(result)
                    logger.info("Plotted %s", station.id)
                else:
                    logger.warning("No plot produced for %s", station.id)
            except Exception as e:
                logger.error("Error processing %s: %s", station.id, e)

    return plots
