__device__ int helper(int x) {
    return x * 2;
}

__global__ void run(int *out) {
    out[0] = helper(21);
}
