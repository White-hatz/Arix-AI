import pytest
from backend.app.services.coder_agent import CoderAgentSession


def test_sanitize_error_resource_exhausted():
    session = CoderAgentSession(workspace_root=".")
    
    # Raw Google RPC error from the screenshot
    raw_error = Exception(
        "generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: gemini-3.6-flash: "
        "Please retry in 58.483145746s., status: RESOURCE_EXHAUSTED, details: [{'@type': 'type.googleapis.com/google.rpc.Help', "
        "'links': [{'description': 'Learn more about Gemini API quotas', 'url': 'https://ai.google.dev/gemini-api/docs/rate-limits'}]}]"
    )
    
    clean = session._sanitize_error(raw_error)
    # Must be human-friendly, concise, and contain retry advice without raw JSON dumps
    assert "Gemini API Quota Exceeded" in clean
    assert "retry suggested in 58.483145746s" in clean
    assert "details:" not in clean
    assert "@type" not in clean


def test_sanitize_error_general():
    session = CoderAgentSession(workspace_root=".")
    err = Exception("File not found: details: {'path': '/some/missing/file'}")
    clean = session._sanitize_error(err)
    assert clean == "File not found"
