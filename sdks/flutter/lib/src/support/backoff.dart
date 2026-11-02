import 'dart:math' as math;

final math.Random _jitterRandom = math.Random();

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
