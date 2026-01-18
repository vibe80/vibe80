#!/bin/sh
set -e

if [ -n "${GIT_SSH_PRIVATE_KEY:-}" ]; then
  mkdir -p /home/app/.ssh
  printf "%s\n" "$GIT_SSH_PRIVATE_KEY" > /home/app/.ssh/id_rsa
  chmod 600 /home/app/.ssh/id_rsa
fi

exec npm run start
