from flask import Flask, render_template, request, jsonify

app = Flask(__name__)


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/game_master", methods=["POST"])
def game_master():
    data = request.get_json() or {}
    player_move = data.get("player_move")
    opponent_move = data.get("opponent_move")

    # Prisoner's Dilemma scoring logic
    if player_move == "cooperate" and opponent_move == "cooperate":
        player_change = 3
        opponent_change = 3
        message = "Both cooperated. A win-win (+3 each)!"
    elif player_move == "betray" and opponent_move == "cooperate":
        player_change = 5
        opponent_change = 0
        message = "You betrayed them while they cooperated (+5 to you, +0 to them)!"
    elif player_move == "cooperate" and opponent_move == "betray":
        player_change = 0
        opponent_change = 5
        message = "You cooperated, but they betrayed you (+0 to you, +5 to them)!"
    else: # betray and betray
        player_change = 1
        opponent_change = 1
        message = "Both betrayed. Defiance leads to minimal gains (+1 each)!"

    return jsonify({
        "player_change": player_change,
        "opponent_change": opponent_change,
        "message": message
    })


if __name__ == "__main__":
    app.run(debug=True)
    