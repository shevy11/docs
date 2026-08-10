# Crisp importer

`import-to-crisp.mjs` imports the English and Hebrew articles configured in `docs.json` into a Crisp Helpdesk.

Before you run it, initialize the Helpdesk in Crisp. In the Crisp dashboard, create a website token under **Settings** > **Workspace Settings** > **Advanced configuration**. Keep its identifier and secret private.

Run a dry run first. It reads the site and makes no Crisp API calls.

```bash
node scripts/import-to-crisp.mjs
```

Then import every article and publish it:

```bash
CRISP_WEBSITE_ID="your-workspace-id" \
CRISP_TOKEN_ID="your-token-id" \
CRISP_TOKEN_KEY="your-token-secret" \
node scripts/import-to-crisp.mjs --execute
```

To import only one language, pass `--locale=en` or `--locale=he`.

The script creates missing locales and categories. On every run, it updates the Crisp article with the same title in the same locale. That includes its title, description, Markdown content, category, ordering, and published state. Do not make manual edits to those Crisp articles unless you also update the corresponding MDX file. It spaces requests and automatically retries Crisp rate-limit responses. It converts Mintlify callouts to Markdown blockquotes. Review article formatting and internal links in Crisp after import.
