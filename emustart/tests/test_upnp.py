"""UPnP: adresy podane przez urządzenia w sieci — tylko http(s) na prywatny adres IP (issue #15)."""

from __future__ import annotations

import pytest

from emustart import upnp


@pytest.mark.parametrize("url", [
    "http://192.168.1.1:5000/rootDesc.xml",
    "http://10.0.0.138:49152/gatedesc.xml",
    "https://172.16.5.1/igd.xml",
    "http://[fe80::1]:5000/rootDesc.xml",
])
def test_lan_url_accepts_router_in_local_network(url):
    assert upnp._lan_url(url) == url


@pytest.mark.parametrize("url", [
    "file:///C:/Windows/win.ini",
    "ftp://192.168.1.1/x.xml",
    "http://8.8.8.8/rootDesc.xml",
    "http://example.com/rootDesc.xml",
    "http:///rootDesc.xml",
    "",
])
def test_lan_url_rejects_other_schemes_and_hosts(url):
    with pytest.raises(upnp.UpnpError):
        upnp._lan_url(url)


def test_from_location_does_not_open_rejected_address(monkeypatch):
    opened = []
    monkeypatch.setattr(upnp.urllib.request, "urlopen", lambda *a, **k: opened.append(a))
    with pytest.raises(upnp.UpnpError):
        upnp.Gateway.from_location("file:///etc/passwd")
    assert opened == []


def test_from_location_rejects_control_url_outside_lan(monkeypatch):
    xml = (b'<root xmlns="urn:schemas-upnp-org:device-1-0"><device><serviceList><service>'
           b'<serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType>'
           b'<controlURL>http://1.1.1.1/ctl</controlURL></service></serviceList></device></root>')

    class Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return xml

    monkeypatch.setattr(upnp.urllib.request, "urlopen", lambda *a, **k: Resp())
    with pytest.raises(upnp.UpnpError):
        upnp.Gateway.from_location("http://192.168.1.1:5000/rootDesc.xml")
