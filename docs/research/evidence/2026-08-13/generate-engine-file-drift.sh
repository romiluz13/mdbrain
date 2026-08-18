#!/usr/bin/env bash
# generate-engine-file-drift.sh — v2.0.0 (2026-08-13)
#
# Snapshot-bound, deterministic drift manifest for the mdbrain vs memongo
# memory-engine source trees.
#
# Input: two explicit FULL git commit IDs (not HEAD, not working trees).
# Method: `git ls-tree -r` on each commit for packages/memory-engine/src;
# file identity = git blob object ID from the tree (no working-tree reads,
# no wall-clock, no absolute roots in the output).
#
# Comparison key: path RELATIVE to packages/memory-engine/src. "Same file"
# means the same relative path in both commits — never basename matching.
#
# Reproducibility scope: byte-for-byte rerunnable by anyone who has both
# commits locally. The memongo commit recorded in the 2026-08-13 manifest
# (8833026c0c...) was UNPUSHED at capture time, so the artifact is locally
# rerunnable but NOT externally reproducible until that commit is pushed or
# archived. This script claims nothing more.
#
# Usage:
#   generate-engine-file-drift.sh <mdbrain_commit> <memongo_commit> \
#       [mdbrain_repo_root] [memongo_repo_root]
set -euo pipefail

MDBRAIN_COMMIT="${1:?full mdbrain commit id required}"
MEMONGO_COMMIT="${2:?full memongo commit id required}"
MDBRAIN_ROOT="${3:-/Users/rom.iluz/Dev/mdbrain}"
MEMONGO_ROOT="${4:-/Users/rom.iluz/Dev/memongo}"
SUB="packages/memory-engine/src/"

# Emit "blob:<sha> <relpath>" lines for one commit.
tree() {
	git -C "$1" ls-tree -r "$2" -- "$SUB" |
		awk -v prefix="$SUB" '{split($0, a, "\t"); p=a[2]; sub("^" prefix, "", p); print "blob:" $3 " " p}' |
		sort -k2
}

m_tmp=$(mktemp)
g_tmp=$(mktemp)
trap 'rm -f "$m_tmp" "$g_tmp"' EXIT
tree "$MDBRAIN_ROOT" "$MDBRAIN_COMMIT" >"$m_tmp"
tree "$MEMONGO_ROOT" "$MEMONGO_COMMIT" >"$g_tmp"

echo "# Engine file drift manifest — generate-engine-file-drift.sh v2.0.0"
echo "# mdbrain commit: $MDBRAIN_COMMIT"
echo "# memongo commit: $MEMONGO_COMMIT"
echo "# comparison key: path relative to packages/memory-engine/src; identity = git blob object id (tree-bound, no working-tree reads)"
echo "# rerunnable locally with both commits present; externally reproducible only if both commits are pushed/archived"

identical=0
diverged=0
only_m=0
only_g=0

# Whitespace-safe iteration over the sorted union of relative paths
# (while-read handles spaces; paths containing newlines are out of scope).
# The 2026-08-13 snapshot contains no whitespace-bearing paths (verified).
while IFS= read -r rel; do
	[ -z "$rel" ] && continue
	h_m=$(awk -v p="$rel" '{q=$0; sub(/^blob:[0-9a-f]+ /, "", q); if (q == p) {sub(/ .*$/, "", $0); print; exit}}' "$m_tmp")
	h_g=$(awk -v p="$rel" '{q=$0; sub(/^blob:[0-9a-f]+ /, "", q); if (q == p) {sub(/ .*$/, "", $0); print; exit}}' "$g_tmp")
	b_m="-"
	b_g="-"
	[ -n "$h_m" ] && b_m="${h_m#blob:}"
	[ -n "$h_g" ] && b_g="${h_g#blob:}"
	if [ "$b_m" != "-" ] && [ "$b_g" != "-" ]; then
		if [ "$b_m" = "$b_g" ]; then
			identical=$((identical + 1))
			echo "IDENTICAL $rel blob_mdbrain:$b_m blob_memongo:$b_g"
		else
			diverged=$((diverged + 1))
			echo "DIVERGED $rel blob_mdbrain:$b_m blob_memongo:$b_g"
		fi
	elif [ "$b_m" != "-" ]; then
		only_m=$((only_m + 1))
		echo "ONLY_MDBRAIN $rel blob_mdbrain:$b_m blob_memongo:-"
	else
		only_g=$((only_g + 1))
		echo "ONLY_MEMONGO $rel blob_mdbrain:- blob_memongo:$b_g"
	fi
done < <(cut -d' ' -f2- "$m_tmp" "$g_tmp" | sort -u)

total=$((identical + diverged))
echo "SUMMARY same-relative-path=$total byte-identical=$identical diverged=$diverged only-mdbrain=$only_m only-memongo=$only_g"
