"""
FinSight AI - Flask REST API Backend
StockSense AI Inventory Decision Engine Integration
"""

import os
import sys
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone

# Ensure backend directory is in python path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(BASE_DIR)
sys.path.append(BASE_DIR)

from inventory_engine import engine

try:
    from flask import Flask, jsonify, request, send_from_directory, session, redirect
    from flask_cors import CORS
except ImportError:
    # Flask will be imported once pip install completes
    Flask = None
    CORS = None
    jsonify = None
    request = None
    send_from_directory = None
    session = None
    redirect = None


def create_app():
    if Flask is None:
        raise RuntimeError("Flask is not installed yet. Please ensure flask and flask-cors are installed.")

    app = Flask(__name__, static_folder=PARENT_DIR, static_url_path='')
    mongo_uri = os.environ.get('MONGODB_URI')
    app.secret_key = os.environ.get('FLASK_SECRET_KEY')
    local_mode = not mongo_uri
    local_db_path = os.path.join(BASE_DIR, 'data', 'finsight_local.sqlite3')
    if local_mode and not app.secret_key:
        secret_path = os.path.join(BASE_DIR, 'data', 'local_flask_secret.key')
        os.makedirs(os.path.dirname(secret_path), exist_ok=True)
        if not os.path.exists(secret_path):
            with open(secret_path, 'w', encoding='utf-8') as secret_file:
                secret_file.write(os.urandom(32).hex())
        with open(secret_path, 'r', encoding='utf-8') as secret_file:
            app.secret_key = secret_file.read().strip()
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE='Lax',
        SESSION_COOKIE_SECURE=os.environ.get('COOKIE_SECURE', '').lower() in ('1', 'true', 'yes'),
        PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 30
    )
    if CORS:
        CORS(app)

    mongo_client = None
    users = None
    business_products = None
    if mongo_uri:
        try:
            from pymongo import MongoClient
            mongo_client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
            database = mongo_client[os.environ.get('MONGODB_DATABASE', 'finsight')]
            users = database['users']
            business_products = database['business_products']
        except Exception as exc:
            app.logger.error('MongoDB setup failed: %s', exc)

    if local_mode:
        os.makedirs(os.path.dirname(local_db_path), exist_ok=True)
        with sqlite3.connect(local_db_path) as local_db:
            local_db.executescript('''
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL, business_name TEXT NOT NULL DEFAULT '',
                    business_category TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS business_products (
                    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, sku TEXT NOT NULL,
                    product_json TEXT NOT NULL, created_at TEXT NOT NULL
                );
            ''')
            table_sql = local_db.execute(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'business_products'"
            ).fetchone()[0]
            if 'UNIQUE(OWNER_ID,SKU)' in ''.join(table_sql.upper().split()):
                local_db.executescript('''
                    ALTER TABLE business_products RENAME TO business_products_unique_sku;
                    CREATE TABLE business_products (
                        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, sku TEXT NOT NULL,
                        product_json TEXT NOT NULL, created_at TEXT NOT NULL
                    );
                    INSERT INTO business_products (id, owner_id, sku, product_json, created_at)
                    SELECT id, owner_id, sku, product_json, created_at FROM business_products_unique_sku;
                    DROP TABLE business_products_unique_sku;
                ''')

    def local_user(email):
        with sqlite3.connect(local_db_path) as local_db:
            local_db.row_factory = sqlite3.Row
            row = local_db.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
            return dict(row) if row else None

    def auth_configuration_error():
        missing = []
        if users is None and not local_mode:
            missing.append('MONGODB_URI')
        if not app.secret_key:
            missing.append('FLASK_SECRET_KEY')
        if missing:
            return jsonify({
                'status': 'error',
                'message': 'Authentication is not configured. Set: ' + ', '.join(missing)
            }), 503
        return None

    @app.before_request
    def require_login_for_app():
        is_auth_route = request.path.startswith('/api/auth/')
        is_model_status = request.path == '/api/model-status'
        is_dashboard = request.path == '/dashboard.html'
        is_business_api = request.path.startswith('/api/') and not is_auth_route and not is_model_status
        if (is_dashboard or is_business_api) and not session.get('user_id'):
            if is_dashboard:
                return redirect('/')
            return jsonify({'status': 'error', 'message': 'Please sign in.'}), 401

    # ==========================================
    # STATIC ROUTES (Serves existing FinSight frontend)
    # ==========================================

    @app.route('/')
    def index():
        return send_from_directory(PARENT_DIR, 'index.html')

    @app.route('/dashboard.html')
    def dashboard():
        return send_from_directory(PARENT_DIR, 'dashboard.html')

    @app.route('/assets/<path:path>')
    def assets(path):
        return send_from_directory(os.path.join(PARENT_DIR, 'assets'), path)

    @app.route('/api/auth/signup', methods=['POST'])
    def api_auth_signup():
        config_error = auth_configuration_error()
        if config_error:
            return config_error

        data = request.get_json(silent=True) or {}
        name = str(data.get('name', '')).strip()
        email = str(data.get('email', '')).strip().lower()
        password = str(data.get('password', ''))
        if not name or '@' not in email or len(password) < 8:
            return jsonify({
                'status': 'error',
                'message': 'Enter your name, a valid email, and a password with at least 8 characters.'
            }), 400

        try:
            from werkzeug.security import generate_password_hash
            from pymongo.errors import DuplicateKeyError, PyMongoError
            user = {
                'name': name,
                'email': email,
                'password_hash': generate_password_hash(password),
                'created_at': datetime.now(timezone.utc)
            }
            if local_mode:
                user_id = uuid.uuid4().hex
                with sqlite3.connect(local_db_path) as local_db:
                    local_db.execute(
                        'INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
                        (user_id, name, email, user['password_hash'], user['created_at'].isoformat())
                    )
            else:
                users.create_index('email', unique=True)
                result = users.insert_one(user)
                user_id = str(result.inserted_id)
            session.clear()
            session['user_id'] = user_id
            session['user_name'] = name
            session['user_email'] = email
            session['business_name'] = ''
            session['business_category'] = ''
            return jsonify({'status': 'success', 'data': {'name': name, 'email': email}}), 201
        except DuplicateKeyError:
            return jsonify({'status': 'error', 'message': 'An account with this email already exists.'}), 409
        except sqlite3.IntegrityError:
            return jsonify({'status': 'error', 'message': 'An account with this email already exists.'}), 409
        except PyMongoError:
            app.logger.exception('MongoDB signup failed')
            return jsonify({'status': 'error', 'message': 'Could not reach the user database. Check your MongoDB settings.'}), 503

    @app.route('/api/auth/login', methods=['POST'])
    def api_auth_login():
        config_error = auth_configuration_error()
        if config_error:
            return config_error

        data = request.get_json(silent=True) or {}
        email = str(data.get('email', '')).strip().lower()
        password = str(data.get('password', ''))
        try:
            from werkzeug.security import check_password_hash
            from pymongo.errors import PyMongoError
            user = local_user(email) if local_mode else users.find_one({'email': email})
            if not user or not check_password_hash(user.get('password_hash', ''), password):
                return jsonify({'status': 'error', 'message': 'Email or password is incorrect.'}), 401

            session.clear()
            session['user_id'] = str(user['id'] if local_mode else user['_id'])
            session['user_name'] = user.get('name', '')
            session['user_email'] = user.get('email', email)
            session['business_name'] = user.get('business_name', '')
            session['business_category'] = user.get('business_category', '')
            session.permanent = bool(data.get('remember'))
            return jsonify({'status': 'success', 'data': {'name': user.get('name', ''), 'email': email}}), 200
        except PyMongoError:
            app.logger.exception('MongoDB login failed')
            return jsonify({'status': 'error', 'message': 'Could not reach the user database. Check your MongoDB settings.'}), 503

    @app.route('/api/auth/me', methods=['GET'])
    def api_auth_me():
        if not session.get('user_id'):
            return jsonify({'status': 'error', 'message': 'Not signed in.'}), 401
        return jsonify({'status': 'success', 'data': {
            'name': session.get('user_name', ''),
            'email': session.get('user_email', ''),
            'user_id': session['user_id'],
            'business_name': session.get('business_name', ''),
            'business_category': session.get('business_category', '')
        }}), 200

    @app.route('/api/auth/logout', methods=['POST'])
    def api_auth_logout():
        session.clear()
        return jsonify({'status': 'success', 'message': 'Signed out.'}), 200

    def serialize_business_product(product):
        """Return a user's product with a forecast informed by recorded sales."""
        date = datetime.now(timezone.utc).date().isoformat()
        baseline_daily_sales = float(product['daily_sales'])
        today = datetime.now(timezone.utc).date()
        tracking_started = product.get('sales_tracking_started')
        sales_history = product.get('sales_history', [])
        logged_sales = 0
        observed_days = 0
        daily_sales_history = {}
        if tracking_started and sales_history:
            try:
                started = datetime.fromisoformat(str(tracking_started)[:10]).date()
                window_start = max(started, today - timedelta(days=29))
                observed_days = max(1, (today - window_start).days + 1)
                for sale in sales_history:
                    sale_date = datetime.fromisoformat(str(sale.get('date', ''))[:10]).date()
                    if window_start <= sale_date <= today:
                        quantity = max(0, int(sale.get('quantity', 0)))
                        logged_sales += quantity
                        daily_sales_history[sale_date.isoformat()] = daily_sales_history.get(sale_date.isoformat(), 0) + quantity
            except (TypeError, ValueError):
                observed_days = 0
                logged_sales = 0
        # The entered daily average acts as a 14-day prior so a single sale
        # cannot make the forecast jump sharply. Recent observed sales gain
        # influence as more days of history accumulate (up to 30 days).
        daily_sales = ((logged_sales + baseline_daily_sales * 14) / (observed_days + 14)
                       if observed_days else baseline_daily_sales)
        raw = {
            'Date': date,
            'Store ID': product.get('store_id', 'S001'),
            'Product ID': product['sku'],
            'Category': product['category'],
            'Region': product.get('region', 'West'),
            'Inventory Level': product['stock'],
            'Price': product['price'],
            'Daily Forecast Demand': daily_sales,
            'Predicted 7-Day Demand': daily_sales * 7
        }
        # The trained model only has meaningful history for products in its
        # training dataset. For newly added SKUs, use the business's entered
        # average daily sales instead of extrapolating from an unknown SKU.
        has_model_history = product['sku'] in engine.products_map
        model_prediction = engine._predict_7day_demand(raw) if has_model_history else None
        prediction = model_prediction if model_prediction is not None else daily_sales * 7
        daily_forecast = prediction / 7
        coverage = float(product['stock']) / max(daily_forecast, 0.01)
        risk = 'High' if coverage < 2 else 'Medium' if coverage < 5 else 'Low'
        safety_stock = daily_sales * float(product.get('lead_days', 7)) * 0.5
        reorder_point = prediction + safety_stock
        recommended_order = max(0, reorder_point - float(product['stock']))
        return {
            'id': str(product['_id']),
            'sku': product['sku'],
            'name': product['name'],
            'category': product['category'],
            'stock': int(product['stock']),
            'unitCost': float(product['price']),
            'supplier': product.get('supplier', 'Supplier not set'),
            'leadDays': int(product.get('lead_days', 7)),
            'predicted7DayDemand': round(prediction, 2),
            'baseSalesDaily': round(daily_forecast, 2),
            'baselineSalesDaily': round(baseline_daily_sales, 2),
            'loggedSalesUnits': logged_sales,
            'salesHistoryDays': observed_days,
            'salesHistory': [
                {'date': sale_date, 'quantity': quantity}
                for sale_date, quantity in sorted(daily_sales_history.items())
            ],
            'daysOfCoverage': round(coverage, 1),
            'riskLevel': risk,
            'recommendedOrder': round(recommended_order, 2),
            'estimatedOrderCost': round(recommended_order * float(product['price']), 2),
            'forecastSource': ('XGBoost 7-day adjusted with recent sales' if model_prediction is not None and observed_days
                               else 'XGBoost 7-day' if model_prediction is not None
                               else 'Recent sales blended with entered average' if observed_days
                               else 'Average daily sales estimate'),
            'factors': {'salesTrend': 34, 'seasonality': 26, 'leadTime': 18, 'priceElasticity': 13, 'categoryMomentum': 9},
            'narrative': (f"{prediction:.1f} units forecast over 7 days using {logged_sales} logged sales across {observed_days} tracked days, blended with the entered average of {baseline_daily_sales:.1f} units/day."
                          if observed_days else f"{prediction:.1f} units forecast over 7 days from the entered average of {baseline_daily_sales:.1f} units/day.")
        }

    @app.route('/api/business/profile', methods=['GET', 'POST'])
    def api_business_profile():
        config_error = auth_configuration_error()
        if config_error:
            return config_error
        try:
            from pymongo.errors import PyMongoError
            email = session.get('user_email', '').lower()
            if request.method == 'GET':
                user = local_user(email) if local_mode else users.find_one({'email': email}, {'business_name': 1, 'business_category': 1})
                business_name = (user or {}).get('business_name', '')
                business_category = (user or {}).get('business_category', '')
                if local_mode:
                    with sqlite3.connect(local_db_path) as local_db:
                        count = local_db.execute('SELECT COUNT(*) FROM business_products WHERE owner_id = ?', (session['user_id'],)).fetchone()[0]
                else:
                    count = business_products.count_documents({'owner_id': session['user_id']})
                return jsonify({'status': 'success', 'data': {
                    'business_name': business_name,
                    'business_category': business_category,
                    'product_count': count
                }}), 200

            data = request.get_json(silent=True) or {}
            business_name = str(data.get('business_name', '')).strip()
            business_category = str(data.get('business_category', '')).strip()
            if not business_name or not business_category:
                return jsonify({'status': 'error', 'message': 'Business name and category are required.'}), 400
            if local_mode:
                with sqlite3.connect(local_db_path) as local_db:
                    local_db.execute('UPDATE users SET business_name = ?, business_category = ? WHERE email = ?',
                                     (business_name, business_category, email))
            else:
                users.update_one({'email': email}, {'$set': {
                    'business_name': business_name,
                    'business_category': business_category
                }})
            session['business_name'] = business_name
            session['business_category'] = business_category
            return jsonify({'status': 'success', 'data': {
                'business_name': business_name,
                'business_category': business_category
            }}), 200
        except PyMongoError:
            app.logger.exception('MongoDB business profile request failed')
            return jsonify({'status': 'error', 'message': 'Could not reach the business database.'}), 503

    @app.route('/api/business/products', methods=['GET', 'POST'])
    def api_business_products():
        config_error = auth_configuration_error()
        if config_error:
            return config_error
        try:
            from pymongo.errors import DuplicateKeyError, PyMongoError
            owner_id = session['user_id']
            if request.method == 'GET':
                if local_mode:
                    import json
                    with sqlite3.connect(local_db_path) as local_db:
                        rows = local_db.execute('SELECT id, product_json FROM business_products WHERE owner_id = ? ORDER BY created_at', (owner_id,)).fetchall()
                    saved = []
                    for product_id, product_json in rows:
                        product = json.loads(product_json)
                        product['_id'] = product_id
                        saved.append(product)
                else:
                    saved = business_products.find({'owner_id': owner_id}).sort('created_at', 1)
                return jsonify({'status': 'success', 'data': [serialize_business_product(p) for p in saved]}), 200

            data = request.get_json(silent=True) or {}
            name = str(data.get('name', '')).strip()
            sku = str(data.get('sku', '')).strip().upper()
            category = str(data.get('category', '')).strip()
            try:
                stock = int(data.get('stock'))
                price = float(data.get('price'))
                daily_sales = float(data.get('daily_sales'))
                lead_days = int(data.get('lead_days', 7))
            except (TypeError, ValueError):
                return jsonify({'status': 'error', 'message': 'Enter valid stock, price, daily sales, and lead-time numbers.'}), 400

            if not name or not sku or not category or stock < 0 or price <= 0 or daily_sales <= 0 or lead_days < 1:
                return jsonify({'status': 'error', 'message': 'Enter a product name, SKU, category, non-negative stock, positive price and daily sales, and lead time of at least one day.'}), 400

            product = {
                'owner_id': owner_id,
                'business_name': session.get('business_name', ''),
                'name': name,
                'sku': sku,
                'category': category,
                'stock': stock,
                'price': price,
                'daily_sales': daily_sales,
                'lead_days': lead_days,
                'store_id': 'S001',
                'region': 'West',
                'created_at': datetime.now(timezone.utc)
            }
            if local_mode:
                import json
                product_id = uuid.uuid4().hex
                product['_id'] = product_id
                with sqlite3.connect(local_db_path) as local_db:
                    local_db.execute('INSERT INTO business_products (id, owner_id, sku, product_json, created_at) VALUES (?, ?, ?, ?, ?)',
                                     (product_id, owner_id, sku,
                                      json.dumps(product, default=lambda value: value.isoformat() if isinstance(value, datetime) else str(value)),
                                      product['created_at'].isoformat()))
            else:
                for index_name, index_info in business_products.index_information().items():
                    if index_info.get('unique') and index_info.get('key') == [('owner_id', 1), ('sku', 1)]:
                        business_products.drop_index(index_name)
                business_products.create_index([('owner_id', 1), ('sku', 1)])
                business_products.insert_one(product)
            return jsonify({'status': 'success', 'data': serialize_business_product(product)}), 201
        except DuplicateKeyError:
            return jsonify({'status': 'error', 'message': 'That SKU is already used in your business.'}), 409
        except sqlite3.IntegrityError:
            return jsonify({'status': 'error', 'message': 'That SKU is already used in your business.'}), 409
        except PyMongoError:
            app.logger.exception('MongoDB business products request failed')
            return jsonify({'status': 'error', 'message': 'Could not reach the product database.'}), 503

    @app.route('/api/business/products/<product_id>/stock', methods=['PATCH'])
    def api_restock_business_product(product_id):
        config_error = auth_configuration_error()
        if config_error:
            return config_error

        data = request.get_json(silent=True) or {}
        try:
            quantity = int(data.get('quantity'))
        except (TypeError, ValueError):
            return jsonify({'status': 'error', 'message': 'Enter a valid restock quantity.'}), 400
        if quantity < 1:
            return jsonify({'status': 'error', 'message': 'Restock quantity must be at least one unit.'}), 400

        owner_id = session['user_id']
        try:
            if local_mode:
                import json
                with sqlite3.connect(local_db_path) as local_db:
                    row = local_db.execute(
                        'SELECT id, product_json FROM business_products WHERE owner_id = ? AND id = ?',
                        (owner_id, product_id)
                    ).fetchone()
                    if not row:
                        return jsonify({'status': 'error', 'message': 'Product was not found in this workspace.'}), 404
                    product_id, product_json = row
                    product = json.loads(product_json)
                    product['stock'] = int(product['stock']) + quantity
                    local_db.execute(
                        'UPDATE business_products SET product_json = ? WHERE id = ? AND owner_id = ?',
                        (json.dumps(product), product_id, owner_id)
                    )
                    product['_id'] = product_id
            else:
                from bson import ObjectId
                try:
                    object_id = ObjectId(product_id)
                except Exception:
                    return jsonify({'status': 'error', 'message': 'Product was not found in this workspace.'}), 404
                result = business_products.update_one(
                    {'owner_id': owner_id, '_id': object_id},
                    {'$inc': {'stock': quantity}}
                )
                if not result.matched_count:
                    return jsonify({'status': 'error', 'message': 'Product was not found in this workspace.'}), 404
                product = business_products.find_one({'owner_id': owner_id, '_id': object_id})

            return jsonify({'status': 'success', 'data': serialize_business_product(product)}), 200
        except Exception:
            app.logger.exception('Business product restock failed')
            return jsonify({'status': 'error', 'message': 'Could not save the product restock.'}), 500

    @app.route('/api/business/products/<product_id>/sales', methods=['POST'])
    def api_record_business_sale(product_id):
        config_error = auth_configuration_error()
        if config_error:
            return config_error
        data = request.get_json(silent=True) or {}
        try:
            quantity = int(data.get('quantity'))
        except (TypeError, ValueError):
            return jsonify({'status': 'error', 'message': 'Enter a valid quantity sold.'}), 400
        if quantity < 1:
            return jsonify({'status': 'error', 'message': 'Quantity sold must be at least one unit.'}), 400

        owner_id = session['user_id']
        today = datetime.now(timezone.utc).date().isoformat()
        sale = {'quantity': quantity, 'date': today}
        try:
            if local_mode:
                import json
                with sqlite3.connect(local_db_path) as local_db:
                    row = local_db.execute(
                        'SELECT id, product_json FROM business_products WHERE owner_id = ? AND id = ?',
                        (owner_id, product_id)
                    ).fetchone()
                    if not row:
                        return jsonify({'status': 'error', 'message': 'Product was not found in this workspace.'}), 404
                    saved_id, product_json = row
                    product = json.loads(product_json)
                    if int(product.get('stock', 0)) < quantity:
                        return jsonify({'status': 'error', 'message': 'Sale quantity cannot exceed current stock.'}), 409
                    product['stock'] = int(product['stock']) - quantity
                    product.setdefault('sales_history', []).append(sale)
                    product['sales_history'] = product['sales_history'][-1800:]
                    product.setdefault('sales_tracking_started', today)
                    local_db.execute(
                        'UPDATE business_products SET product_json = ? WHERE id = ? AND owner_id = ?',
                        (json.dumps(product), saved_id, owner_id)
                    )
                    product['_id'] = saved_id
            else:
                from bson import ObjectId
                try:
                    object_id = ObjectId(product_id)
                except Exception:
                    return jsonify({'status': 'error', 'message': 'Product was not found in this workspace.'}), 404
                query = {'owner_id': owner_id, '_id': object_id, 'stock': {'$gte': quantity}}
                existing = business_products.find_one({'owner_id': owner_id, '_id': object_id}, {'sales_tracking_started': 1})
                if not existing:
                    return jsonify({'status': 'error', 'message': 'Product was not found in this workspace.'}), 404
                updates = {
                    '$inc': {'stock': -quantity},
                    '$push': {'sales_history': {'$each': [sale], '$slice': -1800}}
                }
                if not existing.get('sales_tracking_started'):
                    updates['$set'] = {'sales_tracking_started': today}
                result = business_products.update_one(query, updates)
                if not result.matched_count:
                    return jsonify({'status': 'error', 'message': 'Sale quantity cannot exceed current stock.'}), 409
                product = business_products.find_one({'owner_id': owner_id, '_id': object_id})

            return jsonify({'status': 'success', 'data': serialize_business_product(product)}), 200
        except Exception:
            app.logger.exception('Business product sale recording failed')
            return jsonify({'status': 'error', 'message': 'Could not record the product sale.'}), 500

    # ==========================================
    # API ENDPOINTS
    # ==========================================

    @app.route('/api/model-status', methods=['GET'])
    def api_model_status():
        return jsonify({
            'status': 'success',
            'data': {
                'active_forecast_source': engine.active_forecast_source,
                'model_loaded': engine.forecast_model is not None,
                'message': engine.forecast_model_status
            }
        }), 200

    @app.route('/api/inventory', methods=['GET'])
    def api_inventory():
        try:
            store_id = request.args.get('store_id', 'all')
            data = engine.get_inventory_overview(store_id=store_id)
            return jsonify({
                'status': 'success',
                'data': data
            }), 200
        except Exception as e:
            return jsonify({'status': 'error', 'message': 'Failed to retrieve inventory overview'}), 500

    @app.route('/api/products', methods=['GET'])
    def api_products():
        try:
            category = request.args.get('category', 'all')
            risk_level = request.args.get('risk_level', 'all')
            store_id = request.args.get('store_id', 'all')
            search = request.args.get('search', '')
            limit = request.args.get('limit', type=int)

            products = engine.get_products(
                category=category,
                risk_level=risk_level,
                store_id=store_id,
                search=search,
                limit=limit
            )
            return jsonify({
                'status': 'success',
                'count': len(products),
                'data': products
            }), 200
        except Exception as e:
            return jsonify({'status': 'error', 'message': 'Failed to retrieve products'}), 500

    @app.route('/api/products/<product_id>', methods=['GET'])
    def api_product_detail(product_id):
        try:
            store_id = request.args.get('store_id')
            prod = engine.get_product_by_id(product_id, store_id=store_id)
            if not prod:
                return jsonify({
                    'status': 'error',
                    'message': f"Product with ID '{product_id}' was not found in active inventory."
                }), 404

            return jsonify({
                'status': 'success',
                'data': prod
            }), 200
        except Exception as e:
            return jsonify({'status': 'error', 'message': 'Failed to retrieve product details'}), 500

    @app.route('/api/forecast/<product_id>', methods=['GET'])
    def api_forecast_detail(product_id):
        try:
            store_id = request.args.get('store_id')
            forecast = engine.get_forecast_breakdown(product_id, store_id=store_id)
            if not forecast:
                return jsonify({
                    'status': 'error',
                    'message': f"Forecast breakdown for product '{product_id}' was not found."
                }), 404

            return jsonify({
                'status': 'success',
                'data': forecast
            }), 200
        except Exception as e:
            return jsonify({'status': 'error', 'message': 'Failed to retrieve forecast breakdown'}), 500

    @app.route('/api/reorder-recommendations', methods=['GET'])
    def api_reorder_recommendations():
        try:
            store_id = request.args.get('store_id', 'all')
            recs = engine.get_reorder_recommendations(store_id=store_id)
            return jsonify({
                'status': 'success',
                'summary': recs['summary'],
                'data': recs['recommendations']
            }), 200
        except Exception as e:
            return jsonify({'status': 'error', 'message': 'Failed to retrieve reorder recommendations'}), 500

    @app.route('/api/reorder-recommendations/<id>/approve', methods=['POST'])
    def api_approve_recommendation(id):
        try:
            store_id = request.args.get('store_id')
            new_po = engine.approve_recommendation(id, store_id=store_id)
            if not new_po:
                return jsonify({
                    'status': 'error',
                    'message': f"Could not create purchase order for product '{id}'."
                }), 404

            return jsonify({
                'status': 'success',
                'message': f"Purchase Order {new_po['id']} generated successfully.",
                'data': new_po
            }), 201
        except Exception as e:
            return jsonify({'status': 'error', 'message': 'Failed to approve recommendation'}), 500

    @app.route('/api/ai-insights', methods=['GET'])
    def api_ai_insights():
        try:
            store_id = request.args.get('store_id', 'all')
            insights = engine.get_ai_insights(store_id=store_id)
            return jsonify({
                'status': 'success',
                'data': insights
            }), 200
        except Exception as e:
            return jsonify({'status': 'error', 'message': 'Failed to compute AI insights'}), 500

    @app.route('/api/dashboard', methods=['GET'])
    def api_dashboard():
        try:
            store_id = request.args.get('store_id', 'all')
            overview = engine.get_inventory_overview(store_id=store_id)
            recs = engine.get_reorder_recommendations(store_id=store_id)
            insights = engine.get_ai_insights(store_id=store_id)

            return jsonify({
                'status': 'success',
                'data': {
                    'overview': overview,
                    'reorder_summary': recs['summary'],
                    'urgent_reorders': recs['recommendations'][:6],
                    'insights': insights,
                    'validated_forecast_source': engine.active_forecast_source
                }
            }), 200
        except Exception as e:
            return jsonify({'status': 'error', 'message': 'Failed to load dashboard data'}), 500

    @app.route('/api/purchase-orders', methods=['GET', 'POST'])
    def api_purchase_orders():
        try:
            if request.method == 'GET':
                status = request.args.get('status', 'all')
                orders = engine.get_purchase_orders(status=status)
                return jsonify({
                    'status': 'success',
                    'count': len(orders),
                    'data': orders
                }), 200

            elif request.method == 'POST':
                data = request.get_json() or {}
                new_po = engine.create_purchase_order(data)
                return jsonify({
                    'status': 'success',
                    'message': f"Purchase Order {new_po['id']} created.",
                    'data': new_po
                }), 201

        except Exception as e:
            return jsonify({'status': 'error', 'message': 'Failed to process purchase orders'}), 500

    @app.route('/api/purchase-orders/<po_id>/status', methods=['PATCH'])
    def api_update_po_status(po_id):
        try:
            data = request.get_json() or {}
            new_status = data.get('status')
            if not new_status:
                return jsonify({'status': 'error', 'message': 'Status parameter is required'}), 400

            updated = engine.update_po_status(po_id, new_status)
            if not updated:
                return jsonify({'status': 'error', 'message': f"Purchase Order '{po_id}' was not found"}), 404

            return jsonify({
                'status': 'success',
                'message': f"Status for {po_id} updated to {new_status}",
                'data': updated
            }), 200
        except Exception as e:
            return jsonify({'status': 'error', 'message': 'Failed to update purchase order status'}), 500

    @app.errorhandler(404)
    def not_found(e):
        return jsonify({'status': 'error', 'message': 'Resource not found'}), 404

    @app.errorhandler(500)
    def server_error(e):
        return jsonify({'status': 'error', 'message': 'An internal server error occurred'}), 500

    return app


if __name__ == '__main__':
    # Try creating and running Flask app
    try:
        application = create_app()
        print("FinSight AI + StockSense Backend running on port 5000...")
        application.run(host='0.0.0.0', port=5000, debug=False)
    except Exception as exc:
        print(f"Flask App Startup Error: {exc}")
