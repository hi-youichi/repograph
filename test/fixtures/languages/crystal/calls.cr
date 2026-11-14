def helper(name : String) : String
  "hello, #{name}"
end

def run
  message = helper("world")
  puts message
end

run
