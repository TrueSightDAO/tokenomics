# Agroverse QR Code API

This service provides a smart endpoint to verify cacao bags in the supply chain. When someone scans the QR code on a bag, the embedded value is sent to this API, which looks up the bag details in a Google Sheet and returns JSON data or redirects the visitor to the correct resource.

## Architecture

- **Google Apps Script** (`web_service.gs`)
  - Exposes `doGet(e)` to handle GET requests.
  - Reads `qr_code` from query parameters.
  - Looks up the record in a Google Sheet (`Agroverse QR codes`).
  - Returns bag metadata as JSON, or an error/instructions object.

- **NGINX** (`api_truesight_me.conf`)
  - Listens on `api.truesight.me` (HTTP→HTTPS redirect).
  - Namespaces API endpoints under `/v1/` and proxies them to the Apps Script URL.
  - Redirects all other paths to the documentation repo.

## Usage

### Query Parameters
- `qr_code` (required): the serialized bag identifier embedded in the QR code.
- `format` (optional): if set to `json`, the API returns the full record as JSON (columns A–D: `qr_code`, `landing_page`, `ledger`, `status`), bypassing any redirect.

1. Scan the QR code on a cacao bag.
2. Your client opens:
   ```
   http://api.truesight.me/v1/?qr_code=HAPPY_BAG
   ```
3. Possible responses:
   - **200 OK** with JSON bag details if `qr_code` is found.
   - **200 OK** with `{ error, instructions }` if `qr_code` is missing or unknown.
   - **302 Redirect** to documentation for paths outside `/v1/`.
   - **200 OK** with full JSON record (columns A–D: `qr_code`, `landing_page`, `ledger`, `status`) if `format=json` is supplied as a query parameter (overrides any redirect).

## Configuration

- **DNS**: Create a CNAME `api.truesight.me` pointing to your NGINX server.
- **SSL**: Place certificates at:
  - `/etc/ssl/certs/api.truesight.me.crt`
  - `/etc/ssl/private/api.truesight.me.key`
**NGINX** (`api_truesight_me.conf`):
  This repository provides two main setups:

  A) Full SSL-proxy (production-ready):
     ```nginx
     upstream google_app_web_service {
         server script.google.com:443 max_fails=0;
     }
     server {
         listen 443 ssl;
         server_name api.truesight.me;

         ssl_certificate     /etc/ssl/certs/api.truesight.me.crt;
         ssl_certificate_key /etc/ssl/private/api.truesight.me.key;

         add_header Strict-Transport-Security max-age=31536000;

         location /v1/ {
             proxy_pass https://google_app_web_service/macros/s/YOUR_SCRIPT_ID/exec$is_args$args;
             proxy_set_header Host              script.google.com;
             proxy_set_header X-Real-IP         $remote_addr;
             proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
             proxy_set_header X-Forwarded-Proto https;
         }
     }
     ```

  B) Temporary HTTP-only redirect (V1 hack):
     ```nginx
     server {
         listen 80;
         server_name api.truesight.me;

         # Redirect /v1/ calls to Apps Script endpoint
         location /v1/ {
             return 302 https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec$is_args$args;
         }

         # Redirect all other requests to documentation
         location / {
             return 302 https://github.com/TrueSightDAO/tokenomics/tree/main/google_app_scripts/agroverse_qr_code_checking;
         }
     }
     ```

  After editing your config, reload NGINX:
  ```bash
  nginx -t && systemctl reload nginx
  ```
  2. Reload NGINX:
-  ```bash
  nginx -t && systemctl reload nginx
  ```
- **Web App URL**:
  - `https://script.google.com/macros/s/AKfycbxigq4-J0izShubqIC5k6Z7fgNRyVJLakfQ34HPuENiSpxuCG-wSq0g-wOAedZzzgaL/exec`
- - **Google Apps Script** (`web_service.gs`):
  - `SHEET_URL`: URL of the Google Sheet.
    For example:
    https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=472328231#gid=472328231
  - `SHEET_NAME`: `Agroverse QR codes`.
  - `HEADER_ROW`: 2 (where column names live).
  - `DATA_START_ROW`: 3 (where data begins).
  - `QR_CODE_PARAM`: `qr_code` (header name).

## Extending and Redirects

By default, if your spreadsheet includes a column named `landing_page` (in the header row) and a column named `status`, the API will automatically:

1. Look up the `qr_code` in your sheet.
2. Extract `redirect_url` and `status` for that row.
3. Send back an HTML‐based redirect to the URL in `redirect_url`.
4. Append a `status` query parameter: `?status=<encoded status>` (or `&status=…` if the URL already has parameters).

Example:

  Sheet header row (row 2):
    | qr_code | landing_page               | status    |
    |---------|----------------------------|-----------|
    | ABC123  | https://shop.example.com/a | delivered |

  Request:
    https://api.truesight.me/v1/?qr_code=ABC123

  Result: immediate HTML redirect →
    https://shop.example.com/a?status=delivered

If there’s no `redirect_url` column or the row’s value is empty, the API continues returning JSON as before.

## License

This project is released under the MIT License. See LICENSE for details.