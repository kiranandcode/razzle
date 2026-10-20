#!/usr/bin/env bash
# Download the browser speech models into the directory the server serves at /models/
# (RAZZLE_MODELS_DIR, default <repo>/models), so a studio talking to a server with
# RAZZLE_AUDIO=browser loads them from there instead of the Hugging Face hub. (The ONNX Runtime
# WebAssembly binary is part of the studio build.)
#
#   server/fetch-models.sh
#
# Two Whisper exports, as the studio picks them (src/asr/worker.ts, ASR_MODELS):
#   onnx-community/whisper-base.en  with WebGPU: fp16 encoder (fp32 where the GPU lacks f16
#                                   shaders) + 4-bit decoder; 41 + 82 + 124 MB
#   onnx-community/whisper-tiny.en  on the CPU (WebAssembly): 8-bit encoder + decoder; 41 MB
# plus each one's configs and tokenizer (~3 MB). A browser downloads only the files it uses, once
# (they are cached). Re-running skips files that are already complete.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
DIR="${RAZZLE_MODELS_DIR:-$ROOT/models}"
HUB="${HF_ENDPOINT:-https://huggingface.co}"

CONFIGS=(config.json generation_config.json preprocessor_config.json tokenizer.json tokenizer_config.json)
declare -a GET=()
for f in "${CONFIGS[@]}"; do GET+=("onnx-community/whisper-base.en/$f" "onnx-community/whisper-tiny.en/$f"); done
GET+=(
  onnx-community/whisper-base.en/onnx/encoder_model_fp16.onnx
  onnx-community/whisper-base.en/onnx/encoder_model.onnx
  onnx-community/whisper-base.en/onnx/decoder_model_merged_q4.onnx
  onnx-community/whisper-tiny.en/onnx/encoder_model_quantized.onnx
  onnx-community/whisper-tiny.en/onnx/decoder_model_merged_quantized.onnx
)

fetch() { # url dest
  local url="$1" dest="$2" want have
  mkdir -p "$(dirname "$dest")"
  want="$(curl -sfIL "$url" | tr -d '\r' | awk 'tolower($1)=="content-length:"{n=$2} END{print n}')"
  have="$( [ -f "$dest" ] && wc -c < "$dest" | tr -d ' ' || echo 0)"
  if [ -n "$want" ] && [ "$want" = "$have" ]; then echo "  have $dest"; return; fi
  echo "  get  $url"
  curl -fsSL --retry 3 -o "$dest.part" "$url"
  mv "$dest.part" "$dest"
}

echo "models -> $DIR"
for f in "${GET[@]}"; do
  model="${f%%/onnx/*}"; model="${model%/*.json}"
  fetch "$HUB/${model}/resolve/main/${f#"$model"/}" "$DIR/$f"
done
du -sh "$DIR"
