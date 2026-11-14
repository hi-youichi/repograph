#!/usr/bin/perl
use strict;
use warnings;

sub helper {
    my ($name) = @_;
    return "Hello, $name";
}

sub run {
    my $greeting = helper("world");
    print "$greeting\n";
    return;
}

run();
