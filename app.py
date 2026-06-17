from flask import Flask, Blueprint, render_template, request, jsonify
import os
import json
import random
import textwrap

# --- Blueprint for /game/ prefix ---
game_bp = Blueprint('game', __name__,
                    template_folder='templates',
                    static_folder='static',
                    static_url_path='/static')

DATA_FILE = "data.json"

DEFAULT_STATE = {
    "settings": {
        "payoff_cc": 3,
        "payoff_dd": 1,
        "payoff_t": 5,
        "payoff_s": 0,
        "player1_strategy": "manual",
        "player2_strategy": "angel",
        "max_rounds": 10,
        "tournament_rounds": 10
    },
    "custom_strategies": {},
    "game_history": {
        "player_score": 0,
        "ai_score": 0,
        "round": 1,
        "player_history": [],
        "ai_history": [],
        "last_result_message": "Make your first move."
    },
    "tournament_history": {
        "leaderboard_visible": False,
        "matrix_visible": False,
        "leaderboard_html": "",
        "matrix_html": ""
    }
}


@game_bp.route("/")
def home():
    return render_template("index.html")


@game_bp.route("/api/state", methods=["GET"])
def get_state():
    if not os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "w") as f:
                json.dump(DEFAULT_STATE, f, indent=2)
            return jsonify(DEFAULT_STATE)
        except Exception as e:
            return jsonify({"error": f"Failed to initialize data file: {str(e)}"}), 500
    try:
        with open(DATA_FILE, "r") as f:
            data = json.load(f)
        return jsonify(data)
    except Exception as e:
        return jsonify(DEFAULT_STATE)


@game_bp.route("/api/state", methods=["POST"])
def save_state():
    try:
        data = request.get_json() or {}
        with open(DATA_FILE, "w") as f:
            json.dump(data, f, indent=2)
        return jsonify({"status": "success", "message": "State saved to data.json successfully!"})
    except Exception as e:
        return jsonify({"status": "error", "message": f"Failed to save state: {str(e)}"}), 500



@game_bp.route("/game_master", methods=["POST"])
def game_master():
    data = request.get_json() or {}
    player_move = data.get("player_move")
    opponent_move = data.get("opponent_move")

    # Read dynamic payoffs from client (fall back to default Prisoner's Dilemma parameters if not provided)
    payoff_cc = int(data.get("payoff_cc", 3))
    payoff_dd = int(data.get("payoff_dd", 1))
    payoff_t = int(data.get("payoff_t", 5))
    payoff_s = int(data.get("payoff_s", 0))

    # Prisoner's Dilemma scoring logic with dynamic values
    if player_move == "cooperate" and opponent_move == "cooperate":
        player_change = payoff_cc
        opponent_change = payoff_cc
        message = f"Both cooperated. A win-win (+{payoff_cc} each)!"
    elif player_move == "betray" and opponent_move == "cooperate":
        player_change = payoff_t
        opponent_change = payoff_s
        message = f"You betrayed them while they cooperated (+{payoff_t} to you, +{payoff_s} to them)!"
    elif player_move == "cooperate" and opponent_move == "betray":
        player_change = payoff_s
        opponent_change = payoff_t
        message = f"You cooperated, but they betrayed you (+{payoff_s} to you, +{payoff_t} to them)!"
    else: # betray and betray
        player_change = payoff_dd
        opponent_change = payoff_dd
        message = f"Both betrayed. Defiance leads to minimal gains (+{payoff_dd} each)!"

    return jsonify({
        "player_change": player_change,
        "opponent_change": opponent_change,
        "message": message
    })


# --- Restricted exec helpers for user Python strategies ---

SAFE_BUILTINS = {
    "abs": abs, "bool": bool, "dict": dict, "enumerate": enumerate,
    "float": float, "int": int, "len": len, "list": list, "max": max,
    "min": min, "range": range, "round": round, "sorted": sorted,
    "str": str, "sum": sum, "tuple": tuple, "zip": zip,
    "True": True, "False": False, "None": None,
    "print": print,
}


def _run_strategy_code(code, my_history, opponent_history):
    """
    Execute user-submitted Python strategy code and return the result.

    Supports two formats:
    1. A full function definition (def strategy(...): ...)
       — The function is called directly.
    2. Raw body code (if/return statements without a wrapping def)
       — The code is wrapped inside a generated function automatically.
    """
    safe_globals = {"__builtins__": SAFE_BUILTINS, "random": random}
    local_ns = {}

    # Check if the code defines a top-level 'strategy' function
    stripped = code.strip()
    if stripped.startswith("def strategy(") or stripped.startswith("def strategy ("):
        # User provided a full function definition — exec it and call directly
        exec(code, safe_globals, local_ns)
        if "strategy" not in local_ns:
            raise ValueError(
                "Code starts with 'def strategy(...)' but no 'strategy' "
                "function was found after execution."
            )
        func = local_ns["strategy"]
        result = func(list(my_history), list(opponent_history))
        return result

    # Fallback: wrap raw body code inside a generated function
    indented_code = textwrap.indent(code, "    ")
    wrapped = f"def _user_strategy(my_history, opponent_history):\n{indented_code}"

    exec(wrapped, safe_globals, local_ns)
    func = local_ns["_user_strategy"]
    result = func(list(my_history), list(opponent_history))
    return result


@game_bp.route("/api/execute_strategy", methods=["POST"])
def execute_strategy():
    """Execute a user's Python strategy code for a single move."""
    data = request.get_json() or {}
    code = data.get("code", "")
    my_history = data.get("my_history", [])
    opponent_history = data.get("opponent_history", [])

    if not code.strip():
        return jsonify({"error": "No code provided."}), 400

    try:
        result = _run_strategy_code(code, my_history, opponent_history)
        if result not in ("cooperate", "betray"):
            return jsonify({
                "error": f"Strategy must return 'cooperate' or 'betray'. Got: {repr(result)}"
            }), 400
        return jsonify({"result": result})
    except Exception as e:
        return jsonify({"error": f"Execution error: {str(e)}"}), 400


@game_bp.route("/api/validate_strategy", methods=["POST"])
def validate_strategy():
    """Validate a user's Python strategy by running 3 test cases."""
    data = request.get_json() or {}
    code = data.get("code", "")

    if not code.strip():
        return jsonify({"valid": False, "error": "No code provided."}), 400

    test_cases = [
        ([], []),
        (["cooperate"], ["betray"]),
        (["betray", "cooperate"], ["cooperate", "betray"]),
    ]

    for i, (my_hist, opp_hist) in enumerate(test_cases):
        try:
            result = _run_strategy_code(code, my_hist, opp_hist)
            if result not in ("cooperate", "betray"):
                return jsonify({
                    "valid": False,
                    "error": f"Test case {i+1}: Must return 'cooperate' or 'betray'. Got: {repr(result)}"
                })
        except Exception as e:
            return jsonify({
                "valid": False,
                "error": f"Test case {i+1} error: {str(e)}"
            })

    return jsonify({"valid": True})


# --- App Factory ---

def create_app():
    app = Flask(__name__)

    # Register the game blueprint under /game/ prefix
    app.register_blueprint(game_bp, url_prefix='/game')

    # Redirect root to /game/
    @app.route("/")
    def root_redirect():
        from flask import redirect
        return redirect("/game/")

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(host="0.0.0.0", port=3000, debug=True)