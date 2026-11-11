#!/usr/bin/env bash
# Publishes the project to GitHub: source on `main`, the built game on `gh-pages` (GitHub Pages).
#
#   GH_TOKEN=<token> tools/deploy_pages.sh            fully automatic: creates the repo, registers
#                                                     the deploy key, pushes, switches Pages on
#   tools/deploy_pages.sh <owner>                     the repo and deploy key were set up by hand
#
# Pushes go over SSH with a dedicated key (~/.ssh/iwestlake_deploy); the token is only used for
# the GitHub REST API and is never written to disk or to the git config.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="${WL_REPO:-iWestlake}"
KEY="${WL_KEY:-$HOME/.ssh/iwestlake_deploy}"
OWNER="${1:-}"
API=https://api.github.com
api() { curl -sS -m 60 -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "$@"; }
field() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$1','') if isinstance(d,dict) else '')"; }

[ -f "$KEY" ] || ssh-keygen -q -t ed25519 -f "$KEY" -N "" -C "$REPO deploy key"

if [ -n "${GH_TOKEN:-}" ]; then
  USER_JSON=$(api "$API/user")
  LOGIN=$(echo "$USER_JSON" | field login); UID_=$(echo "$USER_JSON" | field id)
  [ -n "$LOGIN" ] || { echo "token rejected: $USER_JSON" >&2; exit 1; }
  OWNER="${OWNER:-$LOGIN}"
  EMAIL="${UID_}+${LOGIN}@users.noreply.github.com"
  if [ "$(api -o /dev/null -w '%{http_code}' "$API/repos/$OWNER/$REPO")" = 404 ]; then
    echo "creating $OWNER/$REPO (public)"
    api -X POST "$API/user/repos" -d "{\"name\":\"$REPO\",\"private\":false,\"has_wiki\":false,\"description\":\"RING ZERO: a small WebGL first-person shooter set in the Academic Ring of Westlake University's Yungu Campus (unofficial fan project)\",\"homepage\":\"https://$OWNER.github.io/$REPO/\"}" | field full_name
  else
    echo "$OWNER/$REPO already exists"
  fi
  PUB=$(cat "$KEY.pub")
  api -X POST "$API/repos/$OWNER/$REPO/keys" -d "{\"title\":\"deploy from dev box\",\"key\":\"$PUB\",\"read_only\":false}" | field title | sed 's/^/deploy key: /' || true
else
  [ -n "$OWNER" ] || { echo "usage: GH_TOKEN=... $0   or   $0 <owner>" >&2; exit 1; }
  # keep the identity of the first (token) deploy if this checkout already has one
  EMAIL="${WL_EMAIL:-$(git config user.email 2>/dev/null || echo "$OWNER@users.noreply.github.com")}"
fi
REMOTE="${WL_REMOTE:-git@github.com:$OWNER/$REPO.git}"
export GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
TRAILER="Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

echo "building"
npm run build --silent
[ -f dist/index.html ] && [ -f dist/.nojekyll ] || { echo "build output incomplete" >&2; exit 1; }

# --- the built site -> gh-pages (its own history; pushed first so the game goes live early)
SITE=$(mktemp -d)
cp -r dist/. "$SITE"/
git -C "$SITE" init -q -b gh-pages
git -C "$SITE" -c user.name="$OWNER" -c user.email="$EMAIL" add -A
git -C "$SITE" -c user.name="$OWNER" -c user.email="$EMAIL" commit -q -m "Deploy RING ZERO" -m "$TRAILER"
echo "pushing gh-pages ($(du -sh "$SITE" --exclude=.git | cut -f1))"
git -C "$SITE" push -f "$REMOTE" gh-pages
rm -rf "$SITE"

# --- the source -> main
[ -d .git ] || git init -q -b main
git config user.name "$OWNER"; git config user.email "$EMAIL"
git add -A
if ! git diff --cached --quiet; then
  git commit -q -m "RING ZERO: a small WebGL shooter set on Westlake University's Yungu Campus" -m "$TRAILER"
fi
git remote remove origin 2>/dev/null || true
git remote add origin "$REMOTE"
echo "pushing main"
git push -u origin main

if [ -n "${GH_TOKEN:-}" ]; then
  code=$(api -o /dev/null -w '%{http_code}' -X POST "$API/repos/$OWNER/$REPO/pages" -d '{"source":{"branch":"gh-pages","path":"/"}}')
  echo "enable Pages: HTTP $code (201 = switched on, 409 = already on)"
fi
echo "done: https://$OWNER.github.io/$REPO/  (the first Pages build takes a minute or two)"
