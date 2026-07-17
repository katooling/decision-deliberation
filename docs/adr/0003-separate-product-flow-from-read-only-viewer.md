# Keep product writes separate from the read-only viewer mode

The product application may create interview sessions and persisted deliberation runs, but `deliberate view` remains a read-only loopback surface. Write routes exist only when `deliberate app` explicitly supplies a product workflow. This preserves the viewer's inspection contract, keeps cross-site write protection local to the product mode, and lets the recommendation-first page hand users into the same proven reasoning viewer without duplicating graph behavior.
