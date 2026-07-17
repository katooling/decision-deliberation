# Preserve ordered path history as canonical evidence

The MVP stores every Decision Branch by its complete ordered question-and-answer history and performs no semantic merging. This costs duplicate exploration when two paths appear equivalent, but it prevents a false merge from destroying the path-dependent evidence required for hindsight and makes exact replay possible.
