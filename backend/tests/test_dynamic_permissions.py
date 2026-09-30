from pathlib import Path
import pytest
from backend.app.tools.safety import (
    PermissionRequiredError,
    resolve_user_path,
    grant_session_path,
    revoke_session_path,
    get_session_granted_paths,
)
from backend.app.api.settings import (
    get_permissions_route,
    update_permission_policy_route,
    grant_permission_route,
    revoke_permission_route,
)


def test_permission_required_for_outside_path(tmp_path: Path) -> None:
    root = tmp_path / "allowed_root"
    root.mkdir()
    outside = tmp_path / "outside_root" / "document.txt"
    outside.parent.mkdir()
    outside.write_text("hello", encoding="utf-8")

    # Without confirmation, accessing outside root raises PermissionRequiredError
    with pytest.raises(PermissionRequiredError) as exc_info:
        resolve_user_path(str(outside), allowed_roots=(root,), confirmed=False)
    
    err = exc_info.value
    assert err.path == str(outside.resolve())
    assert err.requires_permission is True

    # With confirmation (user approves), it grants access and succeeds
    resolved = resolve_user_path(str(outside), allowed_roots=(root,), confirmed=True)
    assert resolved == outside.resolve()

    # Once granted in session, subsequent calls succeed even without explicit confirmed=True
    resolved_again = resolve_user_path(str(outside), allowed_roots=(root,), confirmed=False)
    assert resolved_again == outside.resolve()

    # After revoking, access requires permission again
    revoke_session_path(str(outside))
    with pytest.raises(PermissionRequiredError):
        resolve_user_path(str(outside), allowed_roots=(root,), confirmed=False)


@pytest.mark.asyncio
async def test_permission_api_endpoints() -> None:
    # 1. Fetch current settings
    settings_data = await get_permissions_route()
    assert settings_data["ok"] is True
    assert "policies" in settings_data
    assert "grantedPermissions" in settings_data

    # 2. Update a policy
    updated = await update_permission_policy_route(
        {"category": "fileOperations", "policy": "always_allow"}
    )
    assert updated["ok"] is True
    assert updated["policies"]["fileOperations"] == "always_allow"

    # 3. Grant a permission
    grant_res = await grant_permission_route(
        {"target": "E:\\TestDrive", "category": "file_operations", "scope": "session"}
    )
    assert grant_res["ok"] is True
    assert grant_res["granted"] is True

    # 4. Revoke the permission
    revoke_res = await revoke_permission_route(
        {"target": "E:\\TestDrive"}
    )
    assert revoke_res["ok"] is True

    # 5. Reset policy to always_ask
    await update_permission_policy_route(
        {"category": "fileOperations", "policy": "always_ask"}
    )
