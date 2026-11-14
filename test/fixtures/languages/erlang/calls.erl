-module(a).
-export([run/0]).

helper(X) -> X + 1.

run() -> helper(41).
