# Contributing to Hob

Thanks for helping. Bug reports, plugins and pull requests are all welcome.

## Run it

Requires Node.js 24 and pnpm 10.

```sh
pnpm install
pnpm dev              # run Hob
pnpm -C app test      # unit tests
pnpm -C app e2e       # end-to-end tests (hidden window, stand-in model)
```

## Pull requests

- Keep each pull request to one change, with a test that shows it working.
- Run the unit and end-to-end tests before opening it. CI runs them on Mac, Windows and Linux.
- Write interface text in plain words for people who aren't technical.

## Plugins

Most new abilities can be a plugin instead of a change to Hob itself. See the [plugin guide](docs/plugins/README.md).

## Bugs

Open an issue with what you did, what you expected and what happened. Include your system (Mac, Windows or Linux) and the model shown in Settings.
