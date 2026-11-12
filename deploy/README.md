# deploy/

Templates and examples for running LaughTime.lol on your own server.
`bash install.sh` (in the project folder) uses them – you only need to touch
these files for a manual setup.

| File | What it is |
| --- | --- |
| `laughtime.service` | systemd unit template for the app. `install.sh` replaces the `@PLACEHOLDERS@` and installs it as `/etc/systemd/system/laughtime.service`. |
| `cloudflared-laughtime.service` | systemd unit template for the Cloudflare Tunnel of this instance, installed as `/etc/systemd/system/cloudflared-<tunnel name>.service`. Separate from the stock `cloudflared.service`, so another tunnel on the same server keeps working. |
| `cloudflared.example.yml` | Example of the tunnel configuration `install.sh` writes to `/etc/cloudflared/<tunnel name>.yml`. |
| `nginx.example.conf` | Reverse proxy example for servers that do not use the tunnel (`bash install.sh --no-tunnel`). |

## Manual setup with systemd

```bash
sed -e 's|@USER@|laughtime|g' -e 's|@GROUP@|laughtime|g' \
    -e 's|@APP_DIR@|/opt/laughtime|g' -e "s|@NODE@|$(command -v node)|g" \
    -e "s|@PATH@|$(dirname "$(command -v node)"):/usr/local/bin:/usr/bin:/bin|g" \
    -e 's|@PORT_ENV@||g' -e 's|@CAPS@||g' \
    deploy/laughtime.service | sudo tee /etc/systemd/system/laughtime.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now laughtime
```

`@CAPS@` stays empty for ports from 1024 on; for a port below 1024 use
`CAP_NET_BIND_SERVICE`. `@PORT_ENV@` can hold `Environment=SERVER_PORT=8080`
when the port should differ from the one in `.env`.

## Files the installer writes

- `data/install.log` – everything the installer did (ignored by git, like the whole `data/` folder)
- `data/install.state` – the choices of the last run (domain, port, tunnel name), so `--update` and `--uninstall` need no flags
- `/etc/systemd/system/laughtime.service`, `/etc/systemd/system/cloudflared-<tunnel name>.service`
- `/etc/cloudflared/<tunnel name>.yml` and a copy of the tunnel credentials `/etc/cloudflared/<tunnel id>.json` (mode 600)

`bash install.sh --uninstall` removes exactly these system files again. `.env`
and `data/` are never deleted.
