"""Hob plugin tool: arguments arrive as JSON on stdin; whatever is printed goes back to Hob."""
import json
import sys
import urllib.error
import urllib.request

args = json.load(sys.stdin)
amount = float(args["amount"])
src, dst = args["from"].strip().upper(), args["to"].strip().upper()

url = f"https://api.frankfurter.dev/v1/latest?base={src}&symbols={dst}"
req = urllib.request.Request(url, headers={"User-Agent": "Hob (https://github.com/FrigadeHQ/hob)"})
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.load(r)
except urllib.error.HTTPError as e:
    if e.code == 404:
        print(f"Unknown currency code: {src} or {dst}. Use ISO codes like EUR, USD, JPY.")
        sys.exit(0)
    raise

rate = data["rates"][dst]
result = amount * rate
print(f"{amount:,.2f} {src} = {result:,.2f} {dst} (1 {src} = {rate:,.4f} {dst}, European Central Bank rate for {data['date']})")
