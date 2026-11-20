#!/usr/bin/env python3
"""Collect a Jira Data Center inventory or preview a mapping plan locally."""
import argparse
import getpass
import json
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Jira:
    def __init__(self, url, token):
        parts = urlsplit(url)
        if (parts.scheme != 'https' or not parts.hostname or parts.username
                or parts.password or parts.query or parts.fragment):
            raise ValueError('Use an HTTPS Jira base URL without credentials, query, or fragment.')
        if not token:
            raise ValueError('A personal access token is required.')
        self.base = url.rstrip('/')
        self.token = token
        self.opener = build_opener(NoRedirect())

    def get(self, path, **params):
        url = self.base + '/rest/api/2/' + path
        if params:
            url += '?' + urlencode(params)
        request = Request(url, headers={
            'Accept': 'application/json', 'Authorization': 'Bearer ' + self.token
        })
        try:
            with self.opener.open(request, timeout=30) as response:
                return json.load(response)
        except HTTPError as error:
            raise ValueError(f'{path}: Jira returned HTTP {error.code}') from None
        except URLError as error:
            raise ValueError(f'{path}: {error.reason}') from None


def objects(items, kind=None):
    if not isinstance(items, list):
        raise ValueError('Expected a list from Jira.')
    result = {}
    for item in items:
        identity, name = item.get('id'), item.get('name')
        if identity is None or not isinstance(name, str) or not name.strip():
            raise ValueError('Jira returned an object without an ID or name.')
        entry = {'id': str(identity), 'name': name}
        if kind:
            entry['kind'] = kind
        result[entry['id']] = entry
    return list(result.values())


def discover(jira, keys):
    result = {}
    warnings = []
    for category, endpoint in [('projects', 'project'), ('issueTypes', 'issuetype'),
                               ('statuses', 'status'), ('fields', 'field'),
                               ('permissionSchemes', 'permissionscheme'),
                               ('screens', 'screens'), ('identities', 'role')]:
        try:
            raw = jira.get(endpoint)
            if category == 'permissionSchemes':
                raw = raw['permissionSchemes']
            if category == 'projects':
                raw = [dict(item, name=item['key'] + ' · ' + item['name']) for item in raw
                       if not keys or item['key'].upper() in keys]
                missing = keys - {i['key'].upper() for i in raw}
                if missing:
                    warnings.append('Projects missing or inaccessible: ' + ', '.join(sorted(missing)))
            result[category] = objects(raw, 'Project role' if category == 'identities' else None)
            if category == 'fields':
                schemas = {str(item['id']): item.get('schema') or {} for item in raw}
                for item in result[category]:
                    schema = schemas[item['id']]
                    kind = schema.get('custom') or schema.get('type')
                    if kind:
                        item['kind'] = kind + (':' + schema['items'] if schema.get('items') else '')
        except (ValueError, KeyError, TypeError, AttributeError) as error:
            warnings.append(f'{category}: {error}')
    result['workflows'] = []
    workflows = {}
    for project in result.get('projects', []):
        try:
            scheme = jira.get('project/' + quote(project['id'], safe='') + '/workflowscheme')
            for item in objects([scheme], 'Workflow scheme'):
                workflows[item['id']] = item
            names = [scheme.get('defaultWorkflow'), *(scheme.get('issueTypeMappings') or {}).values()]
            for name in filter(None, names):
                workflows['workflow:' + name] = {'id': 'workflow:' + name, 'name': name, 'kind': 'Workflow'}
        except (ValueError, KeyError, TypeError, AttributeError) as error:
            warnings.append(f"Workflow for {project['name']}: {error}")
    result['workflows'] = list(workflows.values())
    if not result.get('projects'):
        raise ValueError('No visible projects matched. ' + ' '.join(warnings))
    for warning in warnings:
        print('Discovery warning: ' + warning, file=sys.stderr)
    return {'schemaVersion': 1, 'objects': result, 'discoveryWarnings': warnings}


def field_text(value):
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def preview(jira, plan, jql, limit):
    if plan.get('schemaVersion') != 1 or plan.get('mode') != 'plan':
        raise ValueError('Use a version 1 migration plan exported by Jira Migration Studio.')
    for side in ('source', 'target'):
        endpoint = plan[side]
        if endpoint.get('sample') or endpoint.get('hosting') != 'Data Center':
            raise ValueError('Use a plan with real Data Center inventories on both sides.')
    source_url = plan['source'].get('url', '').rstrip('/')
    if source_url and source_url != jira.base:
        raise ValueError('The source URL differs from the Jira URL recorded in the plan.')
    maps = {category: {row['source']['id']: row for row in plan['mappings'].get(category, [])}
            for category in ('projects', 'issueTypes', 'statuses', 'fields')}
    fields = ['project', 'issuetype', 'status', 'summary', 'description', *maps['fields']]
    data = jira.get('search', jql=jql, maxResults=limit, fields=','.join(dict.fromkeys(fields)))
    report = []
    for issue in data['issues'][:limit]:
        source = issue['fields']
        blockers = []
        destinations = {}
        for category, field in [('projects', 'project'), ('issueTypes', 'issuetype'), ('statuses', 'status')]:
            row = maps[category].get(str((source.get(field) or {}).get('id'))) or {}
            if row.get('status') == 'Mapped' and row.get('target'):
                destinations[field] = row['target']
            else:
                blockers.append(f'No destination {field} mapping.')
        additions = []
        for identity, row in maps['fields'].items():
            value = source.get(identity)
            if value is None or value == '' or value == []:
                continue
            if row.get('action') == 'appendToDescription':
                additions.append({'label': row['source']['name'], 'value': field_text(value)})
            elif row.get('status') == 'Unresolved' and identity not in ('summary', 'description'):
                blockers.append('Unresolved field: ' + row['source']['name'])
        description = source.get('description') or ''
        if additions:
            appended = '\n\n'.join(f"{item['label']}: {item['value']}" for item in additions)
            description = '\n\n'.join(filter(None, [field_text(description), appended]))
        report.append({'issue': issue['key'], 'summary': source.get('summary'),
                       'destinations': destinations, 'mappingGaps': blockers,
                       'descriptionPreview': description})
    return {'mode': 'read-only mapping preview', 'matchedInJira': data.get('total'),
            'issuesSampled': len(report), 'issues': report,
            'destinationValidated': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('discover', 'preview'):
        command = commands.add_parser(name)
        command.add_argument('--url', required=True)
        command.add_argument('--output', required=True, type=Path)
        if name == 'discover':
            command.add_argument('--project', action='append', default=[], help='Limit projects by key. Repeat for multiple keys.')
        else:
            command.add_argument('--plan', required=True, type=Path)
            command.add_argument('--jql', required=True)
            command.add_argument('--limit', default=10, type=int, choices=range(1, 51), metavar='1–50')
    args = parser.parse_args()
    try:
        jira = Jira(args.url, getpass.getpass('Jira personal access token: '))
        if args.command == 'discover':
            result = discover(jira, {key.upper() for key in args.project})
        else:
            plan = json.loads(args.plan.read_text(encoding='utf-8'))
            result = preview(jira, plan, args.jql, args.limit)
        with args.output.open('x', encoding='utf-8') as output:
            json.dump(result, output, ensure_ascii=False, indent=2)
            output.write('\n')
        print(f'Saved {args.output}')
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        parser.exit(1, f'Cannot complete {args.command}: {error}\n')


if __name__ == '__main__':
    main()
