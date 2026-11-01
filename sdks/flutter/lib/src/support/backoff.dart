import 'dart:math' as math;

final math.Random _jitterRandom = math.Random();

/// Applies "equal jitter" to a retry delay: the result is uniformly
/// distributed between half of [base] and [base], so many clients recovering
/// from the same outage do not retry in lockstep while the configured delay
/// remains an upper bound.
Duration supportRetryDelayWithJitter(Duration base, [math.Random? random]) {
  final microseconds = base.inMicroseconds;
  if (microseconds <= 0) return Duration.zero;
  final half = microseconds ~/ 2;
  final spread = microseconds - half;
  return Duration(
    microseconds:
        half + ((random ?? _jitterRandom).nextDouble() * spread).round(),
  );
}
