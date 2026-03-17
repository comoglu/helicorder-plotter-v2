from helicorder.models import Station, PlotResult


def test_station_id_with_location():
    s = Station(network="AU", station="CNB", channel="BHZ", location="00")
    assert s.id == "AU.CNB.00.BHZ"
    assert s.nslc == "AU.CNB.00.BHZ"


def test_station_id_without_location():
    s = Station(network="AU", station="CTA", channel="BHZ", location="")
    assert s.id == "AU.CTA.--.BHZ"
    assert s.nslc == "AU.CTA..BHZ"


def test_plot_result_id():
    s = Station(network="AU", station="CNB", channel="BHZ", location="00")
    p = PlotResult(
        station=s,
        filename="AU.CNB.00.BHZ.png",
        thumbnail="AU.CNB.00.BHZ_thumb.png",
        starttime="2026-03-17T00:00:00",
        endtime="2026-03-18T00:00:00",
    )
    assert p.id == "AU.CNB.00.BHZ"
