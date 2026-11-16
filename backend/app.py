"""Start the EduFin API:  python app.py"""
import os

from edufin import create_app

app = create_app()

if __name__ == "__main__":
    port = int(os.getenv("PORT", "5050"))
    print(f"[EduFin] API on http://localhost:{port}  (database: {app.config['DB_MODE']})")
    app.run(host="127.0.0.1", port=port, debug=os.getenv("FLASK_DEBUG") == "1")
