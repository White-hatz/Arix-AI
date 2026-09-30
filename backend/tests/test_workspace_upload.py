from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.tools.coder_tools import resolve_safe_path
from backend.app.tools.safety import get_well_known_system_paths, resolve_user_path


def test_upload_file_endpoint(tmp_path: Path) -> None:
    client = TestClient(app)
    file_bytes = b"Hello, this is a test file for upload."
    files = {"file": ("sample.txt", BytesIO(file_bytes), "text/plain")}
    data = {"workspace_root": str(tmp_path), "destination_subpath": "uploads"}

    response = client.post("/api/workspace/upload", files=files, data=data)
    assert response.status_code == 200
    res = response.json()
    assert res["ok"] is True
    file_info = res["file"]
    assert file_info["name"] == "sample.txt"
    assert file_info["size"] == len(file_bytes)
    assert file_info["is_text"] is True
    assert "test file for upload" in file_info["preview"]
    assert Path(file_info["path"]).exists()
    assert Path(file_info["path"]).read_bytes() == file_bytes


def test_attach_path_endpoint(tmp_path: Path) -> None:
    client = TestClient(app)
    source_file = tmp_path / "data.json"
    source_file.write_text('{"name": "test_arix"}', encoding="utf-8")

    payload = {
        "source_path": str(source_file),
        "workspace_root": str(tmp_path),
        "copy_to_workspace": False,
    }
    response = client.post("/api/workspace/attach-path", json=payload)
    assert response.status_code == 200
    res = response.json()
    assert res["ok"] is True
    file_info = res["file"]
    assert file_info["name"] == "data.json"
    assert file_info["is_text"] is True
    assert "test_arix" in file_info["preview"]
    assert file_info["path"] == str(source_file)


def test_system_paths_endpoint() -> None:
    client = TestClient(app)
    response = client.get("/api/workspace/system-paths")
    assert response.status_code == 200
    res = response.json()
    assert res["ok"] is True
    assert "system_locations" in res
    assert "drives" in res
    locs = res["system_locations"]
    assert any("downloads" in k.lower() for k in locs)


def test_well_known_path_resolution() -> None:
    known = get_well_known_system_paths()
    assert "downloads" in known
    assert "desktop" in known
    assert "documents" in known

    # Resolving "Downloads" alias should resolve to a valid Downloads folder
    resolved = resolve_user_path("Downloads")
    assert resolved.name.lower() == "downloads"
    assert resolved.is_absolute()
    assert resolved.exists()

    # resolve_safe_path should also resolve well-known aliases safely
    resolved_safe = resolve_safe_path(".", "Downloads")
    assert resolved_safe.name.lower() == "downloads"
    assert resolved_safe.exists()

    # If NIMS Assignment exists on disk, it should resolve directly
    if Path("D:/Downloads/NIMS Assignment").exists():
        p1 = resolve_user_path("Downloads/NIMS Assignment")
        assert p1 == Path("D:/Downloads/NIMS Assignment").resolve()
        assert p1.exists()

        p2 = resolve_safe_path(".", "Downloads/NIMS Assignment")
        assert p2 == Path("D:/Downloads/NIMS Assignment").resolve()

        p3 = resolve_user_path("D:\\Downloads\\NIMS Assignment")
        assert p3.exists()


def test_pdf_attach_and_preview() -> None:
    pdf_path = Path("D:/Downloads/NIMS Assignment/Assignment.pdf")
    if not pdf_path.exists():
        return
    client = TestClient(app)
    response = client.post("/api/workspace/attach-path", json={"source_path": str(pdf_path)})
    assert response.status_code == 200
    res = response.json()
    assert res["ok"] is True
    file_info = res["file"]
    assert file_info["name"] == "Assignment.pdf"
    assert file_info["is_text"] is True
    assert "[PDF:" in file_info["preview"]
    assert "Business Communication" in file_info["preview"] or "Assignment" in file_info["preview"]

