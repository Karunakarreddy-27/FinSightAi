# ============================================================
# STOCKSENSE AI
# Complete Inventory Forecasting & Decision Engine
# ============================================================

# Install first if required:
# pip install pandas numpy scikit-learn xgboost joblib

import os
import warnings
import joblib
import numpy as np
import pandas as pd

from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from xgboost import XGBRegressor

warnings.filterwarnings("ignore")


# ============================================================
# CONFIGURATION
# ============================================================

DATA_PATH = "retail_store_inventory.csv"
OUTPUT_DIR = "stocksense_output"

os.makedirs(OUTPUT_DIR, exist_ok=True)


# ============================================================
# 1. LOAD DATA
# ============================================================

print("\n" + "=" * 60)
print("STOCKSENSE AI - INVENTORY INTELLIGENCE")
print("=" * 60)

print("\n[1/15] Loading dataset...")

df = pd.read_csv(DATA_PATH)

df["Date"] = pd.to_datetime(df["Date"])

print("Dataset shape:", df.shape)
print("Date range:", df["Date"].min(), "to", df["Date"].max())


# ============================================================
# 2. DATA QUALITY CHECK
# ============================================================

print("\n[2/15] Checking data quality...")

print("Missing values:", df.isnull().sum().sum())
print("Duplicate rows:", df.duplicated().sum())

# Remove duplicates if present
df = df.drop_duplicates().copy()

# Sort chronologically
group_cols = ["Store ID", "Product ID"]

df = df.sort_values(
    group_cols + ["Date"]
).reset_index(drop=True)


# ============================================================
# 3. FEATURE ENGINEERING
# ============================================================

print("\n[3/15] Creating time features...")

df["Day"] = df["Date"].dt.day
df["Month"] = df["Date"].dt.month
df["DayOfWeek"] = df["Date"].dt.dayofweek
df["WeekOfYear"] = df["Date"].dt.isocalendar().week.astype(int)
df["IsWeekend"] = (df["DayOfWeek"] >= 5).astype(int)


# ============================================================
# 4. LAG FEATURES
# ============================================================

print("[4/15] Creating historical demand features...")

df["Lag_1"] = (
    df.groupby(group_cols)["Units Sold"]
      .shift(1)
)

df["Lag_2"] = (
    df.groupby(group_cols)["Units Sold"]
      .shift(2)
)

df["Lag_3"] = (
    df.groupby(group_cols)["Units Sold"]
      .shift(3)
)

df["Lag_7"] = (
    df.groupby(group_cols)["Units Sold"]
      .shift(7)
)

df["Lag_14"] = (
    df.groupby(group_cols)["Units Sold"]
      .shift(14)
)

df["Lag_21"] = (
    df.groupby(group_cols)["Units Sold"]
      .shift(21)
)

df["Lag_28"] = (
    df.groupby(group_cols)["Units Sold"]
      .shift(28)
)


# ============================================================
# 5. ROLLING FEATURES
# ============================================================

print("[5/15] Creating rolling demand features...")

df["Rolling_Mean_7"] = (
    df.groupby(group_cols)["Units Sold"]
      .transform(
          lambda x:
          x.shift(1).rolling(7).mean()
      )
)

df["Rolling_Mean_14"] = (
    df.groupby(group_cols)["Units Sold"]
      .transform(
          lambda x:
          x.shift(1).rolling(14).mean()
      )
)

df["Rolling_Mean_30"] = (
    df.groupby(group_cols)["Units Sold"]
      .transform(
          lambda x:
          x.shift(1).rolling(30).mean()
      )
)

df["Rolling_Median_7"] = (
    df.groupby(group_cols)["Units Sold"]
      .transform(
          lambda x:
          x.shift(1).rolling(7).median()
      )
)

df["Rolling_Std_7"] = (
    df.groupby(group_cols)["Units Sold"]
      .transform(
          lambda x:
          x.shift(1).rolling(7).std()
      )
)

df["EWMA_7"] = (
    df.groupby(group_cols)["Units Sold"]
      .transform(
          lambda x:
          x.shift(1)
           .ewm(span=7, adjust=False)
           .mean()
      )
)


# ============================================================
# 6. CORRECT 7-DAY FUTURE TARGET
# ============================================================

print("[6/15] Creating 7-day future demand target...")

df["Target_7Day_Demand"] = (
    df.groupby(group_cols)["Units Sold"]
      .transform(
          lambda x:
          x.rolling(7).sum().shift(-7)
      )
)


# ============================================================
# 7. MODEL DATASET
# ============================================================

forecast_features = [

    # Product / location
    "Store ID",
    "Product ID",
    "Category",
    "Region",

    # Business variables
    "Inventory Level",
    "Price",
    "Discount",
    "Weather Condition",
    "Holiday/Promotion",
    "Competitor Pricing",

    # Time
    "Day",
    "Month",
    "DayOfWeek",
    "WeekOfYear",
    "IsWeekend",

    # Historical demand
    "Lag_1",
    "Lag_2",
    "Lag_3",
    "Lag_7",
    "Lag_14",
    "Lag_21",
    "Lag_28",

    # Statistical demand
    "Rolling_Mean_7",
    "Rolling_Mean_14",
    "Rolling_Mean_30",
    "Rolling_Median_7",
    "Rolling_Std_7",
    "EWMA_7"
]

target_column = "Target_7Day_Demand"


model_df = df.dropna(
    subset=forecast_features + [target_column]
).copy()

print("Model dataset:", model_df.shape)


# ============================================================
# 8. TIME-BASED TRAIN / TEST SPLIT
# ============================================================

print("\n[7/15] Creating time-based train/test split...")

split_date = model_df["Date"].quantile(0.80)

train_df = model_df[
    model_df["Date"] <= split_date
].copy()

test_df = model_df[
    model_df["Date"] > split_date
].copy()

print("Train:", len(train_df))
print("Test :", len(test_df))

print(
    "Train period:",
    train_df["Date"].min(),
    "to",
    train_df["Date"].max()
)

print(
    "Test period:",
    test_df["Date"].min(),
    "to",
    test_df["Date"].max()
)


X_train = train_df[forecast_features]
X_test = test_df[forecast_features]

y_train = train_df[target_column]
y_test = test_df[target_column]


# ============================================================
# 9. PREPROCESSING
# ============================================================

print("\n[8/15] Preprocessing features...")

categorical_features = [
    "Store ID",
    "Product ID",
    "Category",
    "Region",
    "Weather Condition"
]

numerical_features = [
    col for col in forecast_features
    if col not in categorical_features
]

preprocessor = ColumnTransformer(

    transformers=[

        (
            "categorical",

            OneHotEncoder(
                handle_unknown="ignore",
                sparse_output=False
            ),

            categorical_features
        ),

        (
            "numerical",
            "passthrough",
            numerical_features
        )
    ]
)

X_train_processed = preprocessor.fit_transform(X_train)
X_test_processed = preprocessor.transform(X_test)


# ============================================================
# 10. EVALUATION FUNCTION
# ============================================================

def evaluate_model(actual, predicted):

    mae = mean_absolute_error(
        actual,
        predicted
    )

    rmse = np.sqrt(
        mean_squared_error(
            actual,
            predicted
        )
    )

    r2 = r2_score(
        actual,
        predicted
    )

    wape = (
        np.abs(
            actual.values - predicted
        ).sum()
        /
        np.abs(actual.values).sum()
    )

    return {
        "MAE": mae,
        "RMSE": rmse,
        "R2": r2,
        "WAPE": wape
    }


# ============================================================
# 11. BASELINE 1 - GLOBAL MEAN
# ============================================================

print("\n[9/15] Evaluating baseline models...")

global_mean = y_train.mean()

global_predictions = np.repeat(
    global_mean,
    len(y_test)
)

global_metrics = evaluate_model(
    y_test,
    global_predictions
)


# ============================================================
# 12. BASELINE 2 - STORE + PRODUCT
# ============================================================

store_product_mean = (
    train_df
    .groupby(
        ["Store ID", "Product ID"]
    )[target_column]
    .mean()
)

store_product_predictions = []

for _, row in test_df.iterrows():

    key = (
        row["Store ID"],
        row["Product ID"]
    )

    prediction = store_product_mean.get(
        key,
        global_mean
    )

    store_product_predictions.append(
        prediction
    )

store_product_predictions = np.array(
    store_product_predictions
)

store_product_metrics = evaluate_model(
    y_test,
    store_product_predictions
)


# ============================================================
# 13. BASELINE 3 - STORE + CATEGORY
# ============================================================

store_category_mean = (
    train_df
    .groupby(
        ["Store ID", "Category"]
    )[target_column]
    .mean()
)

store_category_predictions = []

for _, row in test_df.iterrows():

    key = (
        row["Store ID"],
        row["Category"]
    )

    prediction = store_category_mean.get(
        key,
        global_mean
    )

    store_category_predictions.append(
        prediction
    )

store_category_predictions = np.array(
    store_category_predictions
)

store_category_metrics = evaluate_model(
    y_test,
    store_category_predictions
)


# ============================================================
# 14. XGBOOST
# ============================================================

print("\n[10/15] Training XGBoost...")

xgb_model = XGBRegressor(

    n_estimators=500,

    max_depth=6,

    learning_rate=0.03,

    subsample=0.85,

    colsample_bytree=0.85,

    objective="reg:squarederror",

    random_state=42,

    n_jobs=-1
)

xgb_model.fit(
    X_train_processed,
    y_train
)

xgb_predictions = xgb_model.predict(
    X_test_processed
)

xgb_predictions = np.clip(
    xgb_predictions,
    0,
    None
)

xgb_metrics = evaluate_model(
    y_test,
    xgb_predictions
)


# ============================================================
# 15. MODEL COMPARISON
# ============================================================

print("\n[11/15] Comparing models...")

results = {

    "Global Mean":
        global_metrics,

    "Store + Product":
        store_product_metrics,

    "Store + Category":
        store_category_metrics,

    "XGBoost":
        xgb_metrics
}

comparison = pd.DataFrame(results).T

print("\nMODEL COMPARISON")
print("-" * 70)

print(
    comparison[
        ["MAE", "RMSE", "R2", "WAPE"]
    ]
)

print("\nWAPE (%)")

print(
    comparison["WAPE"] * 100
)


# ============================================================
# 16. SELECT BEST FORECAST
# ============================================================

best_method = comparison[
    "WAPE"
].idxmin()

print("\nSelected forecast method:", best_method)


# ============================================================
# 17. CREATE FINAL FORECAST
# ============================================================

print("\n[12/15] Creating inventory decision engine...")

decision_df = test_df[
    [
        "Date",
        "Store ID",
        "Product ID",
        "Category",
        "Region",
        "Inventory Level",
        "Price"
    ]
].copy()


if best_method == "Global Mean":

    decision_df[
        "Predicted 7-Day Demand"
    ] = global_predictions

elif best_method == "Store + Product":

    decision_df[
        "Predicted 7-Day Demand"
    ] = store_product_predictions

elif best_method == "Store + Category":

    decision_df[
        "Predicted 7-Day Demand"
    ] = store_category_predictions

else:

    decision_df[
        "Predicted 7-Day Demand"
    ] = xgb_predictions


decision_df[
    "Predicted 7-Day Demand"
] = decision_df[
    "Predicted 7-Day Demand"
].clip(lower=0)

decision_df[
    "Forecast Source"
] = best_method


# ============================================================
# 18. SAFETY STOCK
# ============================================================

demand_stats = (
    train_df
    .groupby(
        ["Store ID", "Product ID"]
    )["Units Sold"]
    .agg(["mean", "std"])
    .reset_index()
)

demand_stats[
    "Safety_Stock"
] = 1.65 * demand_stats["std"]

safety_stock_lookup = dict(

    zip(

        zip(
            demand_stats["Store ID"],
            demand_stats["Product ID"]
        ),

        demand_stats["Safety_Stock"]
    )
)

decision_df[
    "Safety Stock"
] = [

    safety_stock_lookup.get(
        (store, product),
        0
    )

    for store, product in zip(
        decision_df["Store ID"],
        decision_df["Product ID"]
    )
]


# ============================================================
# 19. INVENTORY DECISION ENGINE
# ============================================================

decision_df[
    "Daily Forecast Demand"
] = (
    decision_df[
        "Predicted 7-Day Demand"
    ] / 7
)

decision_df[
    "Days of Coverage"
] = (

    decision_df["Inventory Level"]

    /

    decision_df[
        "Daily Forecast Demand"
    ].replace(0, np.nan)
)


decision_df[
    "Risk Level"
] = np.select(

    [

        decision_df[
            "Days of Coverage"
        ] < 2,

        decision_df[
            "Days of Coverage"
        ] < 5

    ],

    [

        "High",

        "Medium"

    ],

    default="Low"
)


decision_df[
    "Reorder Point"
] = (

    decision_df[
        "Predicted 7-Day Demand"
    ]

    +

    decision_df[
        "Safety Stock"
    ]
)


decision_df[
    "Recommended Order"
] = (

    decision_df[
        "Reorder Point"
    ]

    -

    decision_df[
        "Inventory Level"
    ]

).clip(lower=0)


decision_df[
    "Overstock Risk"
] = (

    decision_df[
        "Inventory Level"
    ]

    >

    1.5 *

    decision_df[
        "Predicted 7-Day Demand"
    ]
)


decision_df[
    "Recommended Action"
] = np.select(

    [

        decision_df[
            "Risk Level"
        ] == "High",

        decision_df[
            "Risk Level"
        ] == "Medium",

        decision_df[
            "Overstock Risk"
        ]

    ],

    [

        "Order stock immediately",

        "Plan replenishment",

        "Reduce or slow replenishment"

    ],

    default="No immediate action"
)


# ============================================================
# 20. ANOMALY DETECTION
# ============================================================

anomaly_stats = (

    train_df

    .groupby(
        ["Store ID", "Product ID"]
    )["Units Sold"]

    .agg(["mean", "std"])

    .reset_index()

    .rename(
        columns={
            "mean": "Demand_Mean",
            "std": "Demand_Std"
        }
    )
)

anomaly_df = test_df[
    [
        "Date",
        "Store ID",
        "Product ID",
        "Units Sold"
    ]
].copy()

anomaly_df = anomaly_df.merge(

    anomaly_stats,

    on=[
        "Store ID",
        "Product ID"
    ],

    how="left"
)

anomaly_df[
    "Demand_ZScore"
] = (

    anomaly_df["Units Sold"]
    -
    anomaly_df["Demand_Mean"]

) / anomaly_df[
    "Demand_Std"
].replace(0, np.nan)


anomaly_df[
    "Anomaly Type"
] = np.select(

    [

        anomaly_df[
            "Demand_ZScore"
        ] >= 2,

        anomaly_df[
            "Demand_ZScore"
        ] <= -2

    ],

    [

        "Demand Spike",

        "Demand Drop"

    ],

    default="Normal"
)


decision_df = decision_df.merge(

    anomaly_df[
        [
            "Date",
            "Store ID",
            "Product ID",
            "Demand_ZScore",
            "Anomaly Type"
        ]
    ],

    on=[
        "Date",
        "Store ID",
        "Product ID"
    ],

    how="left"
)


# ============================================================
# 21. ABC ANALYSIS
# ============================================================

print("[13/15] Creating ABC analysis...")

abc_data = train_df.copy()

abc_data[
    "Sales Value"
] = (
    abc_data["Units Sold"]
    *
    abc_data["Price"]
)

product_value = (

    abc_data

    .groupby("Product ID")[
        "Sales Value"
    ]

    .sum()

    .sort_values(
        ascending=False
    )

    .reset_index()
)

product_value[
    "Cumulative Value"
] = product_value[
    "Sales Value"
].cumsum()

total_value = product_value[
    "Sales Value"
].sum()

product_value[
    "Cumulative Percentage"
] = (

    product_value[
        "Cumulative Value"
    ]

    /

    total_value

) * 100


def assign_abc(value):

    if value <= 80:
        return "A"

    elif value <= 95:
        return "B"

    else:
        return "C"


product_value[
    "ABC Class"
] = product_value[
    "Cumulative Percentage"
].apply(assign_abc)


abc_lookup = dict(

    zip(
        product_value["Product ID"],
        product_value["ABC Class"]
    )
)

decision_df[
    "ABC Class"
] = decision_df[
    "Product ID"
].map(abc_lookup)


# ============================================================
# 22. COMBINED ALERT
# ============================================================

decision_df[
    "Combined Alert"
] = np.select(

    [

        (
            (decision_df[
                "Risk Level"
            ] == "High")

            &

            (decision_df[
                "Anomaly Type"
            ] == "Demand Spike")
        ),

        decision_df[
            "Risk Level"
        ] == "High",

        decision_df[
            "Anomaly Type"
        ] == "Demand Spike",

        decision_df[
            "Risk Level"
        ] == "Medium",

        decision_df[
            "Overstock Risk"
        ]

    ],

    [

        "Urgent: Stockout Risk + Demand Spike",

        "Critical Stockout Risk",

        "Demand Spike Detected",

        "Reorder Recommended",

        "Potential Overstock"

    ],

    default="Healthy"
)


# ============================================================
# 23. BUSINESS IMPACT
# ============================================================

decision_df[
    "Current Inventory Value"
] = (

    decision_df[
        "Inventory Level"
    ]

    *

    decision_df[
        "Price"
    ]
)


decision_df[
    "Recommended Order Value"
] = (

    decision_df[
        "Recommended Order"
    ]

    *

    decision_df[
        "Price"
    ]
)


decision_df[
    "Potential Overstock Qty"
] = np.where(

    decision_df[
        "Overstock Risk"
    ],

    (

        decision_df[
            "Inventory Level"
        ]

        -

        decision_df[
            "Predicted 7-Day Demand"
        ]

    ).clip(lower=0),

    0
)


decision_df[
    "Potential Overstock Value"
] = (

    decision_df[
        "Potential Overstock Qty"
    ]

    *

    decision_df[
        "Price"
    ]
)


# ============================================================
# 24. AI EXPLANATION
# ============================================================

def create_explanation(row):

    reasons = []

    reasons.append(
        f"7-day demand forecast is "
        f"{row['Predicted 7-Day Demand']:.1f} units."
    )

    reasons.append(
        f"Current inventory is "
        f"{row['Inventory Level']:.0f} units."
    )

    reasons.append(
        f"Inventory provides approximately "
        f"{row['Days of Coverage']:.1f} days of coverage."
    )

    if row["Risk Level"] == "High":

        reasons.append(
            "Stockout risk is high because "
            "coverage is below 2 days."
        )

    elif row["Risk Level"] == "Medium":

        reasons.append(
            "Replenishment should be planned "
            "because coverage is between 2 and 5 days."
        )

    else:

        reasons.append(
            "Inventory coverage is currently above 5 days."
        )

    if row["Anomaly Type"] == "Demand Spike":

        reasons.append(
            f"A demand spike was detected "
            f"(Z-score: {row['Demand_ZScore']:.2f})."
        )

    if row["Overstock Risk"]:

        reasons.append(
            "Inventory is above the configured "
            "overstock threshold."
        )

    reasons.append(
        f"Product belongs to ABC class "
        f"{row['ABC Class']}."
    )

    reasons.append(
        f"Recommended action: "
        f"{row['Recommended Action']}."
    )

    return " ".join(reasons)


decision_df[
    "Explanation"
] = decision_df.apply(
    create_explanation,
    axis=1
)


# ============================================================
# 25. QUALITY CHECK
# ============================================================

print("\n[14/15] Running final quality checks...")

print("Final shape:", decision_df.shape)

print(
    "Missing values:",
    decision_df.isnull().sum().sum()
)

print(
    "Duplicate rows:",
    decision_df.duplicated().sum()
)

print("\nRisk distribution:")
print(
    decision_df[
        "Risk Level"
    ].value_counts()
)

print("\nAlert distribution:")
print(
    decision_df[
        "Combined Alert"
    ].value_counts()
)

print("\nABC distribution:")
print(
    decision_df[
        "ABC Class"
    ].value_counts()
)


# ============================================================
# 26. SAVE FINAL DATASET
# ============================================================

print("\n[15/15] Saving StockSense artifacts...")

decision_df.to_csv(
    f"{OUTPUT_DIR}/stocksense_master_dataset.csv",
    index=False
)


# Save XGBoost
joblib.dump(
    xgb_model,
    f"{OUTPUT_DIR}/stocksense_xgb_7day.pkl"
)


# Save preprocessor
joblib.dump(
    preprocessor,
    f"{OUTPUT_DIR}/stocksense_preprocessor_7day.pkl"
)


# Save safety stock
joblib.dump(
    safety_stock_lookup,
    f"{OUTPUT_DIR}/stocksense_safety_stock.pkl"
)


# Save ABC lookup
joblib.dump(
    abc_lookup,
    f"{OUTPUT_DIR}/stocksense_abc_lookup.pkl"
)


# Save configuration
config = {

    "selected_method": best_method,

    "global_mean_forecast":
        float(global_mean),

    "baseline_wape":
        float(global_metrics["WAPE"]),

    "xgboost_wape":
        float(xgb_metrics["WAPE"]),

    "store_product_wape":
        float(store_product_metrics["WAPE"]),

    "store_category_wape":
        float(store_category_metrics["WAPE"]),

    "risk_high_days": 2,

    "risk_medium_days": 5,

    "overstock_multiplier": 1.5
}

joblib.dump(
    config,
    f"{OUTPUT_DIR}/stocksense_config.pkl"
)


# ============================================================
# FINAL SUMMARY
# ============================================================

print("\n" + "=" * 60)
print("STOCKSENSE AI COMPLETE")
print("=" * 60)

print("\nForecast comparison:")

print(
    comparison[
        ["MAE", "RMSE", "R2", "WAPE"]
    ]
)

print(
    f"\nSelected forecast method: {best_method}"
)

print(
    f"Selected WAPE: "
    f"{comparison.loc[best_method, 'WAPE'] * 100:.2f}%"
)

print(
    "\nFinal dataset:",
    f"{OUTPUT_DIR}/stocksense_master_dataset.csv"
)

print("\nArtifacts:")

for filename in os.listdir(OUTPUT_DIR):

    print(
        " ✓",
        filename
    )

print("\nStockSense AI pipeline completed successfully.")