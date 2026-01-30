# VRB Docker Quick Start Guide

This guide will help you quickly deploy RocketBase using Docker.

## Download latest docker-compose

```bash
wget https://raw.githubusercontent.com/vski-ai/sdk/refs/heads/main/docker-compose.yaml
wget https://raw.githubusercontent.com/vski-ai/sdk/refs/heads/main/.env.example
```

## Edit Variables

The necessary variables to run VRB are incuded in `.env`

```bash
cp .env.example .env
```

REGISTRY/VERSION may differ depending on the source you're installing from. By
default those variables are targeting default binary distribution.

## Docker Compose

```bash
docker compose up
```

## Create Admin User

Navigate to [http://127.0.0.1:8000/installer](http://127.0.0.1:8000/installer)
and create a superuser.

## Test SDK

The API should run on [http://127.0.0.1:3000](http://127.0.0.1:3000)

Install `vrb-cli`

```bash
deno install -A -g -n vrb-cli https://raw.githubusercontent.com/vski-ai/sdk/refs/heads/main/cli.ts
```

And try to login

```bash
vrb-cli login --email <email> --password <password>
```
