fn foo() -> Int:
    return 1

struct A:
    fn bar(self) -> Int:
        return foo()
