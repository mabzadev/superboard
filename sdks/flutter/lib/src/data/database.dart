import 'transport.dart';

final RegExp _namePattern = RegExp(r'^[a-z][a-z0-9_]{0,47}$');

const Set<String> _reservedParameters = {
  'select',
  'order',
  'limit',
  'cursor',
  'count',
  'upsert',
  'confirm',
};

const Set<String> _operators = {
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'like',
  'ilike',
  'in',
  'is',
};

class SuperBoardDataPage {
  const SuperBoardDataPage({required this.items, this.nextCursor, this.count});

  factory SuperBoardDataPage.fromJson(Map<String, dynamic> json) =>
      SuperBoardDataPage(
        items: asObjectList(json['items']),
        nextCursor: optionalString(json['nextCursor']),
        count: (json['count'] as num?)?.toInt(),
      );

  final List<Map<String, dynamic>> items;
  final String? nextCursor;
  final int? count;

  bool get hasMore => nextCursor != null;
}

class SuperBoardDataQuery {
  SuperBoardDataQuery(this._transport, String table)
    : table = _checkedName(table, 'table'),
      _filters = const [],
      _select = null,
      _order = null,
      _limit = null,
      _cursor = null,
      _count = false;

  SuperBoardDataQuery._copy(
    this._transport,
    this.table,
    this._filters,
    this._select,
    this._order,
    this._limit,
    this._cursor,
    this._count,
  );

  final SuperBoardDataTransport _transport;
  final String table;
  final List<MapEntry<String, String>> _filters;
  final List<String>? _select;
  final String? _order;
  final int? _limit;
  final String? _cursor;
  final bool _count;

  SuperBoardDataQuery select(Iterable<String> columns) {
    final selected = columns
        .map((column) => _checkedName(column, 'columns'))
        .toList(growable: false);
    if (selected.isEmpty) {
      throw ArgumentError.value(
        columns,
        'columns',
        'Select at least one column',
      );
    }
    return _with(select: selected);
  }

  SuperBoardDataQuery eq(String column, Object value) =>
      _filter(column, 'eq', value);

  SuperBoardDataQuery neq(String column, Object value) =>
      _filter(column, 'neq', value);

  SuperBoardDataQuery gt(String column, Object value) =>
      _filter(column, 'gt', value);

  SuperBoardDataQuery gte(String column, Object value) =>
      _filter(column, 'gte', value);

  SuperBoardDataQuery lt(String column, Object value) =>
      _filter(column, 'lt', value);

  SuperBoardDataQuery lte(String column, Object value) =>
      _filter(column, 'lte', value);

  /// Case-sensitive match where `*` matches any sequence of characters.
  SuperBoardDataQuery like(String column, String pattern) =>
      _filter(column, 'like', pattern);

  /// Case-insensitive match where `*` matches any sequence of characters.
  SuperBoardDataQuery ilike(String column, String pattern) =>
      _filter(column, 'ilike', pattern);

  SuperBoardDataQuery inList(String column, Iterable<Object> values) =>
      _filter(column, 'in', values);

  SuperBoardDataQuery isNull(String column) => _filter(column, 'is', null);

  /// Negates [operator] (`eq`, `in`, `is`, ...); `not('a', 'is', null)`
  /// keeps the rows where `a` has a value.
  SuperBoardDataQuery not(String column, String operator, Object? value) =>
      _filter(column, operator, value, negated: true);

  SuperBoardDataQuery order(String column, {bool ascending = true}) => _with(
    order: '${_checkedName(column, 'column')}.${ascending ? 'asc' : 'desc'}',
  );

  SuperBoardDataQuery limit(int count) {
    RangeError.checkValueInInterval(count, 1, 100, 'count');
    return _with(limit: count);
  }

  SuperBoardDataQuery cursor(String cursor) {
    if (cursor.isEmpty) {
      throw ArgumentError.value(cursor, 'cursor', 'Cursor cannot be empty');
    }
    return _with(cursor: cursor);
  }

  SuperBoardDataQuery count() => _with(count: true);

  Future<SuperBoardDataPage> get() async {
    final query = <String, Object>{
      ..._filterQuery(),
      if (_select != null) 'select': _select.join(','),
      if (_order != null) 'order': _order,
      if (_limit != null) 'limit': '$_limit',
      if (_cursor != null) 'cursor': _cursor,
      if (_count) 'count': 'exact',
    };
    return SuperBoardDataPage.fromJson(
      asObject(await _transport.sendJson('GET', _uri(query: query))),
    );
  }

  Future<Map<String, dynamic>> single(String id) async {
    final query = <String, Object>{
      if (_select != null) 'select': _select.join(','),
    };
    return asObject(
      await _transport.sendJson('GET', _uri(id: id, query: query)),
    );
  }

  /// Inserts one row (a map) or up to 100 rows (an iterable of maps) and
  /// returns the stored rows.
  Future<List<Map<String, dynamic>>> insert(
    Object rows, {
    bool upsert = false,
  }) async {
    final Object body;
    if (rows is Map) {
      body = rows.cast<String, Object?>();
    } else if (rows is Iterable<Object?> && rows.every((row) => row is Map)) {
      body = rows.toList(growable: false);
    } else {
      throw ArgumentError.value(rows, 'rows', 'Expected a map or maps');
    }
    final decoded = await _transport.sendJson(
      'POST',
      _uri(query: {if (upsert) 'upsert': 'true'}),
      json: body,
    );
    return body is Map ? [asObject(decoded)] : itemsOf(decoded);
  }

  Future<List<Map<String, dynamic>>> update(Map<String, Object?> values) async {
    _requireFilters();
    return itemsOf(
      await _transport.sendJson(
        'PATCH',
        _uri(query: _filterQuery()),
        json: values,
      ),
    );
  }

  Future<Map<String, dynamic>> updateById(
    String id,
    Map<String, Object?> values,
  ) async =>
      asObject(await _transport.sendJson('PATCH', _uri(id: id), json: values));

  Future<List<Map<String, dynamic>>> delete() async {
    _requireFilters();
    return itemsOf(
      await _transport.sendJson('DELETE', _uri(query: _filterQuery())),
    );
  }

  Future<Map<String, dynamic>> deleteById(String id) async => asObject(
    asObject(await _transport.sendJson('DELETE', _uri(id: id)))['item'],
  );

  Uri _uri({String? id, Map<String, Object>? query}) {
    if (id != null && id.isEmpty) {
      throw ArgumentError.value(id, 'id', 'Row ID cannot be empty');
    }
    return _transport.uri(['db', table, if (id != null) id], query);
  }

  Map<String, Object> _filterQuery() {
    final query = <String, List<String>>{};
    for (final filter in _filters) {
      (query[filter.key] ??= []).add(filter.value);
    }
    return query;
  }

  void _requireFilters() {
    if (_filters.isEmpty) {
      throw const SuperBoardDataException(
        'filter_required',
        'Filtered updates and deletes need at least one filter',
      );
    }
  }

  SuperBoardDataQuery _filter(
    String column,
    String operator,
    Object? value, {
    bool negated = false,
  }) {
    final name = _checkedName(column, 'column');
    if (_reservedParameters.contains(name)) {
      throw ArgumentError.value(
        column,
        'column',
        'This column name is reserved for query parameters',
      );
    }
    if (!_operators.contains(operator)) {
      throw ArgumentError.value(operator, 'operator', 'Unknown operator');
    }
    final operand = switch (operator) {
      'in' => _list(value),
      'is' => _isOperand(value),
      _ => _scalar(value, 'value'),
    };
    final expression = '${negated ? 'not.' : ''}$operator.$operand';
    return _with(filters: [..._filters, MapEntry(name, expression)]);
  }

  SuperBoardDataQuery _with({
    List<MapEntry<String, String>>? filters,
    List<String>? select,
    String? order,
    int? limit,
    String? cursor,
    bool? count,
  }) => SuperBoardDataQuery._copy(
    _transport,
    table,
    filters ?? _filters,
    select ?? _select,
    order ?? _order,
    limit ?? _limit,
    cursor ?? _cursor,
    count ?? _count,
  );
}

String _checkedName(String value, String name) {
  if (!_namePattern.hasMatch(value)) {
    throw ArgumentError.value(value, name, 'Expected ^[a-z][a-z0-9_]{0,47}\$');
  }
  return value;
}

String _isOperand(Object? value) {
  if (value == null) return 'null';
  if (value is bool) return '$value';
  throw ArgumentError.value(value, 'value', 'is accepts null, true or false');
}

String _list(Object? value) {
  if (value is! Iterable<Object?>) {
    throw ArgumentError.value(value, 'value', 'in expects a list of values');
  }
  final items = value.map((item) => _quoted(_scalar(item, 'values'))).toList();
  if (items.isEmpty || items.length > 50) {
    throw ArgumentError.value(value, 'value', 'in accepts 1 to 50 values');
  }
  return '(${items.join(',')})';
}

String _quoted(String value) {
  if (value.isNotEmpty &&
      !value.contains(RegExp(r'[,"()]')) &&
      value.trim() == value) {
    return value;
  }
  return '"${value.replaceAll('"', '""')}"';
}

String _scalar(Object? value, String name) {
  return switch (value) {
    String() => value,
    bool() => '$value',
    int() => '$value',
    double() when value.isFinite => '$value',
    DateTime() => value.toUtc().toIso8601String(),
    null => throw ArgumentError.value(
      value,
      name,
      'Use isNull to match missing values',
    ),
    _ => throw ArgumentError.value(value, name, 'Unsupported filter value'),
  };
}
