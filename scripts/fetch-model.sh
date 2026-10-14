#!/usr/bin/env bash
set -euo pipefail
model='models/seeta_fd_frontal_v1.0.bin'
expected='c4619d066ed35e84d9a8e842860b0dff567aba0cbb139881075538761db3ff5d'
source='https://raw.githubusercontent.com/atomashpolskiy/rustface/fa3d5b5d576c91d1c8a099af381e0f0906a0d3a3/model/seeta_fd_frontal_v1.0.bin'
mkdir -p models
if [[ ! -f "$model" ]] || [[ "$(sha256sum "$model" | cut -d' ' -f1)" != "$expected" ]]; then
  curl --fail --location --retry 3 --output "$model.tmp" "$source"
  echo "$expected  $model.tmp" | sha256sum --check --status
  mv "$model.tmp" "$model"
fi
