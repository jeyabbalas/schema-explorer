# Schema Explorer

Explore and search several JSON Schema data dictionaries at once, entirely in your browser.

Load the JSON Schemas that describe your tabular datasets (one root schema per table), browse each one as a
data dictionary, and search across all of them to check where a variable concept is available.

Built with [json-schema-data-dictionary](https://github.com/jeyabbalas/json-schema-to-data-dictionary).

## Development

```sh
npm install
npm run dev        # http://localhost:5173/schema-explorer/
npm run check      # typecheck, lint, format check, tests, production build
```

## License

MIT © 2026 Jeya Balaji Balasubramanian

## Example datasets

The bundled example datasets (BGS, MWS, OFH, TARGET) are the schema sets of the
[CD3 schemify pilot](https://github.com/mgarciaclosas/cd3-schemify-pilot), Copyright (c) 2026 mgarciaclosas,
MIT License; the license text is redistributed at `public/examples/LICENSE`. Regenerate the copies from a
checkout of that repository with `npm run sync-examples` (`CD3_SOURCE=/path/to/checkout` overrides the
default sibling-directory location).
