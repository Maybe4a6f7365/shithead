#!/usr/bin/env bash
# Generate all 54 unique cards + 1 card back via Higgsfield CLI.
# Style: woodcut (locked from sample). Authenticated via `higgs auth login`.

set -e

export PATH=/home/admin/.hermes/node/bin:$PATH

OUT_DIR="/home/admin/projects/shithead-game/assets/cards"
mkdir -p "$OUT_DIR"

# Locked style prefix
STYLE='Vintage woodcut hand-inked playing card art style, medieval European playing card aesthetic. Ornate baroque decorative borders, hatched line shading, paper grain texture, ink bleed on cream paper. Color palette: cream paper #faf8f3, deep burgundy red #a23a1e, forest green #2d4a2b, antique gold #c8a35a. Portrait orientation 2:3, isolated on white.'

# Get default image model
MODEL=$(higgsfield model list --image --json 2>/dev/null | python3 -c "
import json, sys
d = json.load(sys.stdin)
# Find first recommended image model
models = d.get('models', d) if isinstance(d, dict) else d
if isinstance(models, list) and models:
    print(models[0].get('id') or models[0].get('name') or models[0].get('model_id'))
else:
    print('nano_banana_pro')
" 2>/dev/null || echo "nano_banana_pro")
echo "Using model: $MODEL"

gen_card() {
  local id="$1" prompt="$2"
  local out="$OUT_DIR/$id.png"
  if [ -f "$out" ]; then
    echo "  [skip] $id exists"
    return
  fi
  echo "  [gen ] $id"
  higgsfield generate create "$MODEL" \
    --prompt "$prompt" \
    --aspect-ratio 2:3 \
    --output "$out" \
    --json 2>&1 | tail -3
  if [ -f "$out" ]; then
    local sz=$(stat -c%s "$out" 2>/dev/null || echo 0)
    echo "    OK ($sz bytes)"
  fi
}

# Numbered cards 3-9
for rank in 3 4 5 6 7 8 9; do
  for suit_pair in "spades ♠" "hearts ♥" "diamonds ♦" "clubs ♣"; do
    name=$(echo $suit_pair | awk '{print $1}')
    glyph=$(echo $suit_pair | awk '{print $2}')
    id="card_${rank}_${name}"
    [ -f "$OUT_DIR/$id.png" ] && continue
    prompt="$STYLE Playing card number $rank of $name. Large ornate numeral $rank in center, small $rank in corner with $glyph suit symbol. Decorative woodcut filigree surrounding numeral. Suit symbol $glyph prominent."
    gen_card "$id" "$prompt"
  done
done

# Special: 2 (wild), 10 (clears pile)
for suit_pair in "spades ♠" "hearts ♥" "diamonds ♦" "clubs ♣"; do
  name=$(echo $suit_pair | awk '{print $1}')
  glyph=$(echo $suit_pair | awk '{print $2}')
  [ -f "$OUT_DIR/card_2_${name}.png" ] || {
    id="card_2_${name}"
    prompt="$STYLE Playing card number 2 of $name. Large ornate numeral 2 in center, small 2 in corner with $glyph suit symbol. A small wild-star ornament beneath indicating this card is wild and resets any rank."
    gen_card "$id" "$prompt"
  }
  [ -f "$OUT_DIR/card_10_${name}.png" ] || {
    id="card_10_${name}"
    prompt="$STYLE Playing card number 10 of $name. Large ornate numeral 10 in center, small 10 in corner with $glyph suit symbol. A small crossed-out pile icon beneath indicating this card clears the discard pile."
    gen_card "$id" "$prompt"
  }
done

# Face cards J Q K
for rank in J Q K; do
  for suit_pair in "spades ♠" "hearts ♥" "diamonds ♦" "clubs ♣"; do
    name=$(echo $suit_pair | awk '{print $1}')
    glyph=$(echo $suit_pair | awk '{print $2}')
    [ -f "$OUT_DIR/card_${rank}_${name}.png" ] && continue
    case $rank in
      J) character="a medieval jester-fool portrait with pointed hat" ;;
      Q) character="a noble medieval queen portrait with crown" ;;
      K) character="a powerful medieval king portrait with crown and royal robes" ;;
    esac
    id="card_${rank}_${name}"
    prompt="$STYLE Playing card $rank of $name. Portrait of $character holding a playing card, $rank letter in corner with $glyph suit symbol. Ornate woodcut border frame."
    gen_card "$id" "$prompt"
  done
done

# Aces
for suit_pair in "spades ♠" "hearts ♥" "diamonds ♦" "clubs ♣"; do
  name=$(echo $suit_pair | awk '{print $1}')
  glyph=$(echo $suit_pair | awk '{print $2}')
  [ -f "$OUT_DIR/card_A_${name}.png" ] && continue
  id="card_A_${name}"
  prompt="$STYLE Playing card Ace of $name. Single large ornate $glyph suit symbol dominating center, small A letter in corner with $glyph suit symbol. Ornate woodcut border frame."
  gen_card "$id" "$prompt"
done

# Jokers
for which in 1 2; do
  [ -f "$OUT_DIR/card_joker_$which.png" ] && continue
  id="card_joker_$which"
  prompt="$STYLE Joker playing card. Mischievous medieval jester character portrait with wide grin, pointed fool's cap with bells, juggling playing cards. Hand-inked line work, crosshatch shading, ornate decorative border. The word JOKER in blackletter gothic at top and bottom."
  gen_card "$id" "$prompt"
done

# Card back
[ -f "$OUT_DIR/card_back.png" ] || {
  echo "  [gen ] card_back"
  prompt="$STYLE Playing card back design. Ornate symmetrical baroque pattern, two stylized S monograms in center, floral filigree border, deep burgundy red and forest green ink on cream paper. Portrait 2:3."
  higgsfield generate create "$MODEL" --prompt "$prompt" --aspect-ratio 2:3 --output "$OUT_DIR/card_back.png" 2>&1 | tail -3
}

echo ""
echo "=== generated count ==="
ls "$OUT_DIR/"*.png 2>/dev/null | wc -l
