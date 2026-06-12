from flask import Flask, render_template, request, jsonify
import os
import json
import random
import textwrap

app = Flask(__name__)

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


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/api/state", methods=["GET"])
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


@app.route("/api/state", methods=["POST"])
def save_state():
    try:
        data = request.get_json() or {}
        with open(DATA_FILE, "w") as f:
            json.dump(data, f, indent=2)
        return jsonify({"status": "success", "message": "State saved to data.json successfully!"})
    except Exception as e:
        return jsonify({"status": "error", "message": f"Failed to save state: {str(e)}"}), 500



@app.route("/game_master", methods=["POST"])
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
    Wraps user code inside a function, executes it, and returns the result.
    The user writes code using 'return "cooperate"' or 'return "betray"'.
    """
    # Indent every line of user code to place inside a function body
    indented_code = textwrap.indent(code, "    ")
    wrapped = f"def _user_strategy(my_history, opponent_history):\n{indented_code}"

    safe_globals = {"__builtins__": SAFE_BUILTINS, "random": random}
    local_ns = {}

    exec(wrapped, safe_globals, local_ns)
    func = local_ns["_user_strategy"]
    result = func(list(my_history), list(opponent_history))
    return result


@app.route("/api/execute_strategy", methods=["POST"])
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


@app.route("/api/validate_strategy", methods=["POST"])
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


if __name__ == "__main__":
    app.run(debug=True)
    