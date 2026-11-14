function helper(x) result(y)
    integer, intent(in) :: x
    integer :: y
    y = x + 1
end function helper

function run(n) result(total)
    integer, intent(in) :: n
    integer :: total
    total = helper(n) + helper(n + 1)
end function run
