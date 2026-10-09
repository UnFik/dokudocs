#!/usr/bin/env bash
# One-time setup of the production server for the Deploy workflow, run as root
# from /opt/dokudocs (docs/deployment.md):
#
#   bash scripts/deploy/setup-server.sh <runner registration token>
#
# It adds the github-runner user, lets it run only dokudocs-deploy as root, and
# installs the GitHub Actions runner as a service under that user.
set -euo pipefail

token=${1:?usage: setup-server.sh <runner registration token>}
version=2.338.0
repo=https://github.com/UnFik/dokudocs
here=$(cd "$(dirname "$0")" && pwd)

id github-runner >/dev/null 2>&1 || useradd --create-home --shell /bin/bash github-runner

install -o root -g root -m 0755 "$here/dokudocs-deploy" /usr/local/bin/dokudocs-deploy
printf '%s\n' \
  '# The GitHub runner may deploy a commit on main and nothing else (docs/deployment.md).' \
  'github-runner ALL=(root) NOPASSWD: /usr/local/bin/dokudocs-deploy' \
  >/etc/sudoers.d/dokudocs-deploy
chmod 0440 /etc/sudoers.d/dokudocs-deploy
visudo -c -f /etc/sudoers.d/dokudocs-deploy

runner=/home/github-runner/actions-runner
if [[ ! -x $runner/config.sh ]]; then
  sudo -u github-runner mkdir -p "$runner"
  curl -fsSL "https://github.com/actions/runner/releases/download/v$version/actions-runner-linux-x64-$version.tar.gz" |
    sudo -u github-runner tar -xz -C "$runner"
  "$runner/bin/installdependencies.sh"
fi
cd "$runner"
sudo -u github-runner ./config.sh --unattended --replace \
  --url "$repo" --token "$token" \
  --name "$(hostname)-production" --labels dokudocs-production --work _work
./svc.sh install github-runner
./svc.sh start
