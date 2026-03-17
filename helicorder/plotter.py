from __future__ import annotations

import io
import logging
import os
from concurrent.futures import ProcessPoolExecutor, as_completed

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
    station: Station,
    events: list[Event],
    starttime_iso: str,
    endtime_iso: str,
    output_dir: str,
) -> PlotResult | None:
    """Runs in a worker process. Parses waveform, creates plot + thumbnail."""
    import obspy

    starttime = _to_utc(starttime_iso)
    endtime = _to_utc(endtime_iso)

    try:
        st = obspy.read(io.BytesIO(waveform_bytes))
    except Exception as e:
        logger.error("Failed to parse waveform for %s: %s", station.id, e)
        return None

    if len(st) == 0:
        return None

    # Convert events to obspy dayplot format
    obspy_events = []
    for ev in events:
        ev_time = _to_utc(ev.time_iso)
        if starttime <= ev_time <= endtime:
            obspy_events.append({
                "time": ev_time,
                "text": f"{ev.description[:20]}, M{ev.magnitude:.1f}",
            })

    plot_id = station.id
    output_file = os.path.join(output_dir, f"{plot_id}.png")
    thumbnail_file = os.path.join(output_dir, f"{plot_id}_thumb.png")

    fig = Figure(figsize=(10, 7))
    try:
        st.plot(
            type="dayplot",
            interval=60,
            right_vertical_labels=False,
            vertical_scaling_range=5e3,
            one_tick_per_line=True,
            color=["k", "r", "b", "g"],
            show_y_UTC_label=True,
            events=obspy_events,
            number_of_ticks=5,
            tick_format="%H:%M",
            vertical_plotting_method="mean",
            data_unit="mm/s",
            linewidth=0.5,
            x_labels_size=8,
            y_labels_size=8,
            fig=fig,
        )

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
    waveform_data: list[tuple[Station, bytes]],
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
                data,
                station,
                events,
                starttime_iso,
                endtime_iso,
                output_dir,
            ): station
            for station, data in waveform_data
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
