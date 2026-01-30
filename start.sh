#!/bin/sh
set -e

if [ -n "${GIT_SSH_PRIVATE_KEY:-}" ]; then
  mkdir -p /home/vibecoder/.ssh
  printf "%s\n" "$GIT_SSH_PRIVATE_KEY" > /home/vibecoder/.ssh/id_rsa
  chmod 600 /home/vibecoder/.ssh/id_rsa
fi

if [ -n "${GIT_COMMIT_USER_NAME:-}" ]; then
  git config --global user.name "$GIT_COMMIT_USER_NAME"
fi

if [ -n "${GIT_COMMIT_USER_EMAIL:-}" ]; then
  git config --global user.email "$GIT_COMMIT_USER_EMAIL"
fi

exec npm run start
