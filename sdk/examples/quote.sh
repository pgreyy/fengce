#!/bin/sh
# Quote certificate for the one-NAND test circuit on X Layer (needs Foundry's anvil on PATH).
# Runs on a local fork; nothing is sent to the chain.
npx fengce-quote 0x839bdD6fa7A66416A609A735e11DE5411B98574e 2 --out nand-quote.json

# A circuit that denies all-zero input: give the probe input explicitly, or through a schema.
# npx fengce-quote 0xF9bBdc7f678eb3A49D338ffAcDaaD9339de50a0F 7 \
#   --schema examples/comparator16.schema.json --values '{"a": 430, "b": 400}'
