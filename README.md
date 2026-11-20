# Jira Migration Studio

The prototype maps Jira configuration from two JSON inventories. It exports a migration plan. The Python connector discovers Jira Data Center configuration and previews issue mappings from a machine that can reach Jira. Both connector commands are read-only.

## Run locally

Run `python3 -m http.server --bind 127.0.0.1 --directory dist 8000`, then open `http://127.0.0.1:8000`. Use **Load sample inventories** to try the mapping wizard. The Data Center PAT controls demonstrate setup with placeholder tokens. For live discovery, enter real PATs only at the local connector prompt.

## Rollout

1. Keep Jira inventories, plans containing company details, and credentials outside this source repository.
2. Import the GitHub repository into Netlify. The checked-in configuration publishes `dist` without a build step. Configure site access before using corporate inventories. On the prototype, use sample data for demos.
3. If using a custom domain, add a dedicated subdomain in Netlify. Create its CNAME in Cloudflare using the target Netlify provides and start with DNS-only. Confirm Netlify has issued HTTPS for the subdomain.
4. Use Render for the backend API once it is implemented. The prototype has no API or hosted migration worker. Add the Render Blueprint after the service exists. Keep Jira REST calls on a connector inside the company network for private Jira instances. Any hosted control plane and local connector will need authenticated job exchange and a decision about which data can leave the company network.

Provider docs [Netlify Git deployment](https://docs.netlify.com/manage/projects/add-new-project/) · [Netlify external DNS](https://docs.netlify.com/manage/domains/configure-domains/configure-external-dns/) · [Render Blueprints](https://render.com/docs/infrastructure-as-code)
