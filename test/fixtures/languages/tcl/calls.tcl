proc helper {x} {
    return [expr {$x * 2}]
}

proc run {} {
    set result [helper 21]
    puts $result
}
