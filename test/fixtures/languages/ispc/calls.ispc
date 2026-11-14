static inline uniform float helper(uniform float x) {
    return x * 2.0f;
}

export void run(uniform float in[], uniform float out[], uniform int n) {
    foreach (i = 0 ... n) {
        out[i] = helper(in[i]);
    }
}
