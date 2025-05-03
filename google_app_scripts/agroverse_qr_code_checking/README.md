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
   https://api.truesight.me/v1/?qr_code=<CODE>
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
- **NGINX**:
  1. Update `SCRIPT_ID` in `api_truesight_me.conf` to your Apps Script Deployment ID.
  2. Reload NGINX:
     ```bash
     nginx -t && systemctl reload nginx
     ```
- **Google Apps Script** (`web_service.gs`):
  - `SHEET_URL`: URL of the Google Sheet (`.../edit?gid=472328231`).
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