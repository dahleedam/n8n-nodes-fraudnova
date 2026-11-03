# n8n-nodes-fraudnova

This is an n8n community node. It lets you use FraudNova in your n8n workflows.

[FraudNova](https://fraudnova.com) is a fraud-detection API. It returns a fraud score and risk flags for any IP address, email address or phone number, so a workflow can decide whether to accept, review or block a signup, lead or order.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)  
[Operations](#operations)  
[Credentials](#credentials)  
[Compatibility](#compatibility)  
[Usage](#usage)  
[Resources](#resources)  
[Version history](#version-history)  

## Installation

Once the node is verified by n8n, open the node panel in your workflow editor and search for "FraudNova".

Until then, on a self-hosted n8n instance: go to **Settings → Community nodes → Install** and enter `n8n-nodes-fraudnova`.

See the n8n [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) for details.

## Operations

| Resource | Operation | What it does |
| --- | --- | --- |
| IP Address | Check | Scores one IP address (IPv4 or IPv6) per input item. |
| IP Address | Check Many | Scores the IP address of every input item, up to 100 per request. |
| Email Address | Check | Scores one email address per input item. |
| Email Address | Check Many | Scores the email address of every input item, up to 100 per request. |
| Phone Number | Check | Scores one phone number per input item. |
| Phone Number | Check Many | Scores the phone number of every input item, up to 100 per request. |
| Account | Get Balance | Returns your remaining credits as `{ "credits_remaining": 97 }`. |

Every check operation takes the value to check (`IP Address`, `Email Address` or `Phone Number`, usually an expression such as `{{ $json.ip }}`) and an **Options** collection:

| Option | Applies to | Default | Description |
| --- | --- | --- | --- |
| Simplify | all | on | Return only the most useful fields instead of every field. |
| Risk Threshold | all | 75 | A `fraud_score` at or above this value (0 to 100) sets `flagged` to true. |
| Flag On | all | IP: Proxy, VPN, Tor. Email: Disposable. Phone: VOIP, Risky. | Fields that set `flagged` to true when they are true. |
| Strictness | IP | 2 | 0 = lenient, 3 = strict. |
| Mobile | IP | off | Whether the request comes from a mobile device. |
| User Agent | IP | empty | Visitor user agent, enables device and browser fields (max 512 characters). |
| User Language | IP | empty | Visitor Accept-Language value (max 32 characters). |
| Country | Phone | empty | Two-letter country code hint for the phone number, e.g. `US`. |

Choices for **Flag On**:

- IP Address: Bot Status, Proxy, Recent Abuse, Tor, VPN
- Email Address: Disposable, Honeypot, Leaked, Recent Abuse, Suspect
- Phone Number: Do Not Call, Leaked, Recent Abuse, Risky, Spammer, VOIP

## Credentials

You need a FraudNova account. [Register](https://fraudnova.com/register) to get free trial credits, then create an API key at [fraudnova.com/dashboard/api-keys](https://fraudnova.com/dashboard/api-keys). The key starts with `fn_` and is shown once, so copy it right away.

In n8n, create a **FraudNova API** credential and paste the key into the **API Key** field. n8n sends it as a Bearer token. When you save the credential, n8n tests it with a request to the `/balance` endpoint, which costs no credits.

## Compatibility

Requires n8n 1.x or later. Tested on the current n8n release.

## Usage

### Output

Each check returns one output item per input item, with the checked value, the fraud fields, and three fields added by the node (`flagged`, `flag_reasons`, `credits_remaining`):

```json
{
  "ip": "8.8.8.8",
  "fraud_score": 20,
  "proxy": false,
  "vpn": false,
  "tor": false,
  "recent_abuse": false,
  "bot_status": false,
  "country_code": "US",
  "city": "Mountain View",
  "ISP": "Google",
  "flagged": false,
  "flag_reasons": [],
  "credits_remaining": 97
}
```

The checked value is returned under `ip`, `email` or `phone`. With **Simplify** on (the default), the node returns only these fields, as far as the API returned them for the check:

- IP Address: `fraud_score`, `proxy`, `vpn`, `tor`, `recent_abuse`, `bot_status`, `country_code`, `city`, `ISP`
- Email Address: `valid`, `fraud_score`, `disposable`, `deliverability`, `recent_abuse`, `honeypot`, `leaked`, `dns_valid`, `sanitized_email`
- Phone Number: `valid`, `fraud_score`, `VOIP`, `prepaid`, `risky`, `active`, `carrier`, `line_type`, `country`, `formatted`

Turn **Simplify** off to get every field the API returns for that check type.

### The `flagged` field

`flagged` is `true` when the `fraud_score` is at or above the **Risk Threshold** (default 75), or when any field you selected under **Flag On** is `true`. `flag_reasons` lists which of those fired, for example `["fraud_score", "proxy"]`. Both are calculated from the full API response, whether or not Simplify is on. A failed check is never flagged: error items have no `flagged` field at all, so handle them separately (for example, route items where `error` is set to their own branch before the IF).

### Check Many

**Check Many** sends up to 100 values per request. Items are grouped by their request options (Strictness, Mobile, User Agent, User Language or Country), so each request carries one set of options and every item is checked with its own. Risk Threshold, Flag On and Simplify apply per item. Output items stay in input order.

### Errors

An error on a single check stops the workflow by default. Set the node's **On Error** setting to **Continue** and a failed item comes out as:

```json
{ "error": "<message>", "ip": "8.8.8.8" }
```

**Get Balance** follows the same setting: with On Error set to Continue, a failed call returns one item `{ "error": "<message>" }`.

**Check Many** reports problems per item, and one bad value never stops the run. An item that fails comes out as:

```json
{ "error": "<message>", "code": "invalid_ip", "ip": "not-an-ip" }
```

`code` is the error code for that item, for example `invalid_ip`, `invalid_email`, `invalid_phone`, `insufficient_credits` or `upstream_failed`. An empty value gets the code `empty`. An item whose parameters cannot be read, for example because of a broken expression, gets the code `parameter` when On Error is set to Continue; otherwise the node stops before it sends any request. A problem with the whole request, such as a rejected API key, fails the node. With On Error set to Continue, every item in that request instead gets an error item without a `code`.

### Credits

One check costs one credit, whichever type it is. Failed checks are refunded. `credits_remaining` is on every successful item (not on error items), so you can branch on it or alert yourself before you run out.

### Rate limits

The API allows a generous number of requests per minute for each key, and at most 10 checks in flight at once per account. A **Check Many** request counts as one. The node runs items one after another, and backs off automatically when it gets a 429, with short waits for the concurrency cap and longer waits for the per-minute limit, before failing. With **Check** that fails the item; with **Check Many** a 429 that exhausts its retries fails the whole request of up to 100 items (following On Error). For long lists, use **Check Many**.

### Example: block risky signups

A three-node workflow:

1. **Webhook** receives a signup with an `ip` field.
2. **FraudNova** (IP Address → Check) with IP Address set to `{{ $json.body.ip }}`.
3. **IF** with the condition `{{ $json.flagged }}` is true. (To handle failed checks, add a branch for items where `error` is set before this IF.) Send the true branch to manual review or a block, and the false branch to your normal flow.

Ready-to-import workflows are in the [examples repository](https://github.com/dahleedam/fraudnova-examples/tree/main/examples/n8n).

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
* [FraudNova API documentation](https://fraudnova.com/docs)
* [Guide: automate fraud checks in n8n](https://fraudnova.com/guides/automate-fraud-checks-in-n8n)
* [n8n workflow examples](https://github.com/dahleedam/fraudnova-examples/tree/main/examples/n8n)
* Support: [support@fraudnova.com](mailto:support@fraudnova.com)

Released under the MIT license.

## Version history

* **1.0.0**: Initial release. IP address, email address and phone number checks (single and many), and account balance.

Published versions start at 1.0.0.
