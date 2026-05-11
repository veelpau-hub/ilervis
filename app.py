from flask import Flask, render_template, jsonify, request
import sqlite3
import time
import os
import json
import logging
from pathlib import Path
from functools import wraps

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

app = Flask(__name__)

DB_PATH         = os.getenv('DATABASE_PATH', 'ilervis.db')
STATION_API_KEY = os.getenv('STATION_API_KEY', '')
MAPBOX_TOKEN    = os.getenv('MAPBOX_TOKEN', '')


# ── Database ──────────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS station_readings (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            station_id  TEXT    NOT NULL,
            temperature REAL,
            humidity    REAL,
            pressure    REAL,
            timestamp   INTEGER NOT NULL,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_station_ts
            ON station_readings (station_id, timestamp DESC);
    ''')
    conn.commit()
    conn.close()
    log.info('[db] Inicializada')


# ── Auth helper ───────────────────────────────────────────────────────────────

def require_station_key(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if STATION_API_KEY:
            key = request.headers.get('X-Station-Key', '')
            if key != STATION_API_KEY:
                return jsonify({'error': 'unauthorized'}), 401
        return f(*args, **kwargs)
    return wrapper


# ── Module 1 — Station API ────────────────────────────────────────────────────

@app.route('/api/station/data', methods=['POST'])
@require_station_key
def station_data():
    body = request.get_json(silent=True)
    if not body:
        return jsonify({'error': 'invalid json'}), 400
    try:
        temperature = float(body['temperature'])
        humidity    = float(body['humidity'])
        pressure    = float(body['pressure'])
        timestamp   = int(body.get('timestamp', time.time()))
        station_id  = str(body.get('station_id', 'unknown'))[:50]
    except (KeyError, ValueError, TypeError) as e:
        return jsonify({'error': f'missing field: {e}'}), 400

    conn = get_db()
    conn.execute(
        'INSERT INTO station_readings (station_id, temperature, humidity, pressure, timestamp) '
        'VALUES (?, ?, ?, ?, ?)',
        (station_id, temperature, humidity, pressure, timestamp),
    )
    conn.commit()
    conn.close()
    log.info(f'[station] {station_id} — {temperature}°C {humidity}% {pressure}hPa')
    return jsonify({'status': 'ok'})


@app.route('/api/station/latest')
def station_latest():
    conn = get_db()
    row = conn.execute(
        'SELECT * FROM station_readings ORDER BY timestamp DESC LIMIT 1'
    ).fetchone()
    conn.close()
    if not row:
        return jsonify({'available': False})
    age = int(time.time()) - row['timestamp']
    return jsonify({
        'available':   True,
        'temperature': row['temperature'],
        'humidity':    row['humidity'],
        'pressure':    row['pressure'],
        'timestamp':   row['timestamp'],
        'station_id':  row['station_id'],
        'age_seconds': age,
    })


@app.route('/api/station/history')
def station_history():
    hours = min(int(request.args.get('hours', 24)), 168)
    since = int(time.time()) - hours * 3600
    conn = get_db()
    rows = conn.execute(
        'SELECT temperature, humidity, pressure, timestamp FROM station_readings '
        'WHERE timestamp >= ? ORDER BY timestamp ASC',
        (since,),
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ── Module 2 — Fotogrametria API ──────────────────────────────────────────────

@app.route('/api/fotogrametria/metadata')
def fotogrametria_metadata():
    p = Path('static/fotogrametria_metadata.json')
    if p.exists():
        with open(p) as f:
            return jsonify(json.load(f))
    return jsonify({'available': False})


# ── Module 3 — Mars API ───────────────────────────────────────────────────────

@app.route('/api/mars/metadata')
def mars_metadata():
    p = Path('static/mars_metadata.json')
    if p.exists():
        with open(p) as f:
            return jsonify(json.load(f))
    return jsonify({'available': False})


@app.route('/api/mars/profile')
def mars_profile():
    p = Path('static/mars_profile.json')
    if p.exists():
        with open(p) as f:
            return jsonify(json.load(f))
    return jsonify({'available': False, 'segria': {}, 'mars': {}})


# ── Module 4 — ADS-B placeholder ─────────────────────────────────────────────

@app.route('/api/adsb/aircraft')
def adsb_aircraft():
    return jsonify([])


# ── Frontend ──────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html', mapbox_token=MAPBOX_TOKEN)


# ── Health ────────────────────────────────────────────────────────────────────

@app.route('/health')
def health():
    return jsonify({'status': 'ok'})


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=int(os.getenv('PORT', 5000)), debug=False)
