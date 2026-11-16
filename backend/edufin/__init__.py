"""EduFin API. `create_app()` builds the Flask app; `app.py` runs it."""
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from . import db as database
from .config import load_config
from .core import ApiError


def create_app(overrides: dict | None = None) -> Flask:
    app = Flask(__name__, static_folder=None)
    app.config.update(load_config())
    app.config.update(overrides or {})
    app.config["MAX_CONTENT_LENGTH"] = 512 * 1024  # largest request: a small profile picture

    if app.config["JWT_SECRET_GENERATED"] and not app.config.get("TESTING"):
        print("[EduFin] JWT_SECRET is not set, so a temporary one is in use. "
              "Everyone will be signed out when the server restarts. Set it in backend/.env.")

    store = database.connect(app.config)
    database.prepare(store)  # indexes + sample rewards
    app.extensions["edufin_db"] = store

    if app.config["CORS_ORIGINS"]:
        CORS(app, resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}})

    from .routes_auth import bp as auth_bp
    from .routes_earn import bp as earn_bp
    from .routes_grow import bp as grow_bp
    from .routes_wallet import bp as wallet_bp

    for blueprint in (auth_bp, earn_bp, grow_bp, wallet_bp):
        app.register_blueprint(blueprint)

    @app.get("/api/health")
    def health():
        return jsonify({"ok": True, "database": app.config["DB_MODE"]})

    @app.errorhandler(ApiError)
    def api_error(err):
        return jsonify({"error": err.message}), err.status

    @app.errorhandler(HTTPException)
    def http_error(err):
        if request.path.startswith("/api/"):
            return jsonify({"error": err.description}), err.code
        return err

    @app.errorhandler(Exception)
    def unexpected(err):
        app.logger.exception("Unhandled error")
        return jsonify({"error": "Something went wrong on the server"}), 500

    # When the frontend has been built (npm run build), serve it from here too,
    # so one process runs the whole app.
    dist = app.config["FRONTEND_DIST"]

    @app.get("/")
    @app.get("/<path:path>")
    def frontend(path="index.html"):
        if path.startswith("api/"):
            return jsonify({"error": "Not found"}), 404
        if not (dist / "index.html").exists():
            return jsonify({"message": "EduFin API is running. Start the frontend with `npm run dev` "
                                       "in the frontend folder, or build it with `npm run build`."})
        target = path if (dist / path).is_file() else "index.html"
        return send_from_directory(dist, target)

    return app
