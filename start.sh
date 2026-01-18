#!/bin/sh
set -e

if [ -n "${GIT_SSH_PRIVATE_KEY:-}" ]; then
  mkdir -p /home/app/.ssh
  printf "%s\n" "$GIT_SSH_PRIVATE_KEY" > /home/app/.ssh/id_rsa
  chmod 600 /home/app/.ssh/id_rsa
fi

if [ -n "${GIT_USER_NAME:-}" ]; then
  git config --global user.name "$GIT_USER_NAME"
fi

if [ -n "${GIT_USER_EMAIL:-}" ]; then
  git config --global user.email "$GIT_USER_EMAIL"
fi

exec npm run start
