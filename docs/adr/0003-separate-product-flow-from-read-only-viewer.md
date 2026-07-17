# Keep product writes separate from the read-only viewer mode

The product application may create interview sessions and persisted deliberation runs, but `deliberate view` remains a read-only loopback surface. The viewer server accepts only run storage, static assets, host, and port; it has no product workflow dependency or write-route configuration.

`deliberate app` composes two request-handler adapters behind the shared local HTTP server: a product handler owns the write routes, same-origin checks, and product assets, while a viewer handler owns read-only graph routes and viewer assets. This preserves the viewer's inspection contract and lets the recommendation-first page hand users into the same proven reasoning viewer without duplicating graph behavior.
