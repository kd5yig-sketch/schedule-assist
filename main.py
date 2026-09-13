import os

import webview

from app.api import Api


def main():
    api = Api()
    base_dir = os.path.dirname(os.path.abspath(__file__))
    index_path = os.path.join(base_dir, "app", "static", "index.html")
    webview.create_window(
        "Schedule Assist",
        index_path,
        js_api=api,
        width=1400,
        height=900,
        min_size=(900, 600),
    )
    webview.start()


if __name__ == "__main__":
    main()
