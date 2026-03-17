from typing import Dict, Any


class Filter:
    def inlet(self, body: Dict[str, Any], __user__: Dict[str, Any] = None) -> Dict[str, Any]:
        model = body.get("model")

        # Ensure headers dict exists
        body.setdefault("headers", {})
        body["headers"]["X-Requested-Model"] = model

        return body
