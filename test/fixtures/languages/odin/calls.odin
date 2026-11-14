package fixture

helper :: proc() -> int {
	return 42
}

run :: proc() {
	x := helper()
	_ = x
}
