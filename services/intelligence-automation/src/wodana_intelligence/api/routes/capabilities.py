from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def list_capabilities() -> dict[str, list[str]]:
    return {
        "capabilities": [
            "ai-assistance",
            "document-processing",
            "google-workspace-sync",
            "accounting-sync",
            "messaging-webhooks",
            "scheduled-automation",
        ]
    }
